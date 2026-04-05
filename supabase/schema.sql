-- ============================================================
-- CARTELA SaaS - Supabase Database Schema
-- ============================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- ENUMS
-- ============================================================
CREATE TYPE user_role AS ENUM ('admin', 'sales');
CREATE TYPE client_status AS ENUM (
  'NEW',
  'FOLLOW_UP_1',
  'FOLLOW_UP_2',
  'RECOVERED',
  'LOST',
  'CANCELLED'
);
CREATE TYPE activity_type AS ENUM (
  'EXCEL_UPLOAD',
  'STATUS_CHANGE',
  'NOTE_ADDED',
  'CLIENT_CREATED',
  'USER_CREATED',
  'USER_UPDATED'
);
CREATE TYPE order_level AS ENUM ('RED', 'ORANGE', 'GREEN');

-- ============================================================
-- USERS TABLE (extends Supabase auth.users)
-- ============================================================
CREATE TABLE public.users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  role user_role NOT NULL DEFAULT 'sales',
  avatar_url TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- SALESPERSONS TABLE
-- ============================================================
CREATE TABLE public.salespersons (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- PRODUCTS (CARTELA) TABLE
-- ============================================================
CREATE TABLE public.products (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- CLIENTS TABLE
-- ============================================================
CREATE TABLE public.clients (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  partner_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  salesperson_id UUID REFERENCES public.salespersons(id) ON DELETE SET NULL,
  current_status client_status NOT NULL DEFAULT 'NEW',
  status_reason TEXT,
  notes TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- ORDERS TABLE
-- ============================================================
CREATE TABLE public.orders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  salesperson_id UUID REFERENCES public.salespersons(id) ON DELETE SET NULL,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  month INTEGER NOT NULL CHECK (month >= 1 AND month <= 12),
  year INTEGER NOT NULL DEFAULT EXTRACT(YEAR FROM NOW()),
  quantity DECIMAL(10,2) NOT NULL DEFAULT 0,
  order_level order_level GENERATED ALWAYS AS (
    CASE
      WHEN quantity = 0 THEN 'RED'::order_level
      WHEN quantity < 100 THEN 'ORANGE'::order_level
      ELSE 'GREEN'::order_level
    END
  ) STORED,
  upload_batch_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- UPLOAD BATCHES TABLE
-- ============================================================
CREATE TABLE public.upload_batches (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  uploaded_by UUID NOT NULL REFERENCES public.users(id),
  filename TEXT NOT NULL,
  total_rows INTEGER NOT NULL DEFAULT 0,
  processed_rows INTEGER NOT NULL DEFAULT 0,
  failed_rows INTEGER NOT NULL DEFAULT 0,
  month INTEGER NOT NULL,
  year INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add FK for upload_batch_id
ALTER TABLE public.orders ADD CONSTRAINT orders_upload_batch_fk
  FOREIGN KEY (upload_batch_id) REFERENCES public.upload_batches(id) ON DELETE SET NULL;

-- ============================================================
-- CLIENT STATUS HISTORY TABLE
-- ============================================================
CREATE TABLE public.client_status_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  changed_by UUID NOT NULL REFERENCES public.users(id),
  old_status client_status,
  new_status client_status NOT NULL,
  reason TEXT,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- ACTIVITY LOGS TABLE
-- ============================================================
CREATE TABLE public.activity_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  activity_type activity_type NOT NULL,
  entity_type TEXT,
  entity_id UUID,
  description TEXT NOT NULL,
  metadata JSONB,
  ip_address TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- INDEXES
-- ============================================================
CREATE INDEX idx_orders_client_id ON public.orders(client_id);
CREATE INDEX idx_orders_month_year ON public.orders(month, year);
CREATE INDEX idx_orders_salesperson_id ON public.orders(salesperson_id);
CREATE INDEX idx_orders_product_id ON public.orders(product_id);
CREATE INDEX idx_clients_salesperson_id ON public.clients(salesperson_id);
CREATE INDEX idx_clients_status ON public.clients(current_status);
CREATE INDEX idx_activity_logs_user_id ON public.activity_logs(user_id);
CREATE INDEX idx_activity_logs_created_at ON public.activity_logs(created_at DESC);
CREATE INDEX idx_client_status_history_client_id ON public.client_status_history(client_id);

-- ============================================================
-- VIEWS
-- ============================================================

-- Monthly client metrics view
CREATE VIEW public.client_monthly_metrics AS
SELECT
  c.id AS client_id,
  c.name AS client_name,
  c.partner_id,
  c.current_status,
  sp.id AS salesperson_id,
  sp.name AS salesperson_name,
  sp.code AS salesperson_code,
  o.month,
  o.year,
  COALESCE(SUM(o.quantity), 0) AS total_meters,
  COUNT(DISTINCT o.product_id) AS unique_products,
  CASE
    WHEN COALESCE(SUM(o.quantity), 0) = 0 THEN 'RED'
    WHEN COALESCE(SUM(o.quantity), 0) < 100 THEN 'ORANGE'
    ELSE 'GREEN'
  END AS level
FROM public.clients c
LEFT JOIN public.salespersons sp ON c.salesperson_id = sp.id
LEFT JOIN public.orders o ON c.id = o.client_id
GROUP BY c.id, c.name, c.partner_id, c.current_status, sp.id, sp.name, sp.code, o.month, o.year;

-- Product analytics view
CREATE VIEW public.product_analytics AS
SELECT
  p.id AS product_id,
  p.name AS product_name,
  o.month,
  o.year,
  COUNT(DISTINCT o.client_id) AS unique_clients,
  COALESCE(SUM(o.quantity), 0) AS total_meters,
  COALESCE(AVG(o.quantity), 0) AS avg_meters_per_order,
  COUNT(*) AS order_count
FROM public.products p
LEFT JOIN public.orders o ON p.id = o.product_id
GROUP BY p.id, p.name, o.month, o.year;

-- Salesperson performance view
CREATE VIEW public.salesperson_performance AS
SELECT
  sp.id AS salesperson_id,
  sp.name AS salesperson_name,
  sp.code AS salesperson_code,
  o.month,
  o.year,
  COUNT(DISTINCT o.client_id) AS active_clients,
  COALESCE(SUM(o.quantity), 0) AS total_meters,
  COUNT(DISTINCT o.product_id) AS unique_products
FROM public.salespersons sp
LEFT JOIN public.orders o ON sp.id = o.salesperson_id
GROUP BY sp.id, sp.name, sp.code, o.month, o.year;

-- ============================================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================================
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.salespersons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.upload_batches ENABLE ROW LEVEL SECURITY;

-- Helper function to get current user role
CREATE OR REPLACE FUNCTION public.get_user_role()
RETURNS user_role
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT role FROM public.users WHERE id = auth.uid();
$$;

-- Helper function to get current user's salesperson id
CREATE OR REPLACE FUNCTION public.get_salesperson_id()
RETURNS UUID
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT sp.id FROM public.salespersons sp
  JOIN public.users u ON sp.user_id = u.id
  WHERE u.id = auth.uid();
$$;

-- Users policies
CREATE POLICY "Users can view their own profile" ON public.users
  FOR SELECT USING (id = auth.uid() OR public.get_user_role() = 'admin');

CREATE POLICY "Admins can manage users" ON public.users
  FOR ALL USING (public.get_user_role() = 'admin');

-- Clients policies
CREATE POLICY "Admins can see all clients" ON public.clients
  FOR ALL USING (public.get_user_role() = 'admin');

CREATE POLICY "Sales can see assigned clients" ON public.clients
  FOR SELECT USING (
    public.get_user_role() = 'sales' AND
    salesperson_id = public.get_salesperson_id()
  );

CREATE POLICY "Sales can update assigned clients" ON public.clients
  FOR UPDATE USING (
    public.get_user_role() = 'sales' AND
    salesperson_id = public.get_salesperson_id()
  );

-- Orders policies
CREATE POLICY "Admins can manage all orders" ON public.orders
  FOR ALL USING (public.get_user_role() = 'admin');

CREATE POLICY "Sales can view assigned orders" ON public.orders
  FOR SELECT USING (
    public.get_user_role() = 'sales' AND
    salesperson_id = public.get_salesperson_id()
  );

-- Salespersons - all authenticated can read
CREATE POLICY "Authenticated users can view salespersons" ON public.salespersons
  FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "Admins can manage salespersons" ON public.salespersons
  FOR ALL USING (public.get_user_role() = 'admin');

-- Products - all authenticated can read
CREATE POLICY "Authenticated users can view products" ON public.products
  FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "Admins can manage products" ON public.products
  FOR ALL USING (public.get_user_role() = 'admin');

-- Status history
CREATE POLICY "Admins see all status history" ON public.client_status_history
  FOR SELECT USING (public.get_user_role() = 'admin');

CREATE POLICY "Sales see their clients status history" ON public.client_status_history
  FOR SELECT USING (
    public.get_user_role() = 'sales' AND
    client_id IN (
      SELECT id FROM public.clients WHERE salesperson_id = public.get_salesperson_id()
    )
  );

CREATE POLICY "Users can insert status history" ON public.client_status_history
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

-- Activity logs
CREATE POLICY "Admins see all logs" ON public.activity_logs
  FOR ALL USING (public.get_user_role() = 'admin');

CREATE POLICY "Users can insert logs" ON public.activity_logs
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

-- Upload batches
CREATE POLICY "Admins can manage upload batches" ON public.upload_batches
  FOR ALL USING (public.get_user_role() = 'admin');

-- ============================================================
-- FUNCTIONS & TRIGGERS
-- ============================================================

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER users_updated_at BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TRIGGER clients_updated_at BEFORE UPDATE ON public.clients
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TRIGGER salespersons_updated_at BEFORE UPDATE ON public.salespersons
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- Auto-create user profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.users (id, email, full_name, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    COALESCE((NEW.raw_user_meta_data->>'role')::user_role, 'sales')
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================================
-- SEED DATA
-- ============================================================

-- Sample products (Cartela types)
INSERT INTO public.products (name) VALUES
  ('FILO'), ('OCEAN'), ('KENZO'), ('Y7'), ('HERO'),
  ('SPIDER'), ('LAKZA-E'), ('LAKZA-C'), ('TWIT'),
  ('HUMMER-H3'), ('JP'), ('VAKOO'), ('RAMINI-A'),
  ('RALPH'), ('RENAD'), ('VILON'), ('BOGATY'),
  ('DOVE'), ('OVELY'), ('JAVA'), ('MOSCOW'),
  ('ETRO'), ('SUEDE'), ('MARVEL'), ('TENDER'),
  ('TOUCH'), ('TESLA'), ('POLO'), ('GERMAN'), ('BOKLET');
