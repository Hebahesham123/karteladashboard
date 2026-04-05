# Cartela Analytics - Enterprise SaaS Platform

A full-stack enterprise SaaS platform for managing Cartela (product type) orders, clients, and sales analytics. Built with Next.js 14, Supabase, and a modern UI stack.

## ✨ Features

### Multi-Language (Arabic RTL + English LTR)
- Full RTL/LTR layout switching
- All UI text translatable
- Language switcher in navbar
- Arabic font (Cairo) + English font (Inter)

### 📊 Analytics Dashboards
- **KPI Cards**: Total meters, active clients, at-risk clients, level distribution
- **Monthly Trends**: Area charts showing meters and client count over time
- **Product Analytics**: Best/worst Cartela by meters, growth trends
- **Sales Leaderboard**: Ranked salesperson performance
- **Smart Insights**: Auto-detected at-risk, declining, anomalies

### 👥 Role-Based Access
- **Admin**: Full access to everything
- **Sales**: Only sees assigned clients, can update status and add notes

### 📂 Excel Upload System
- Drag-and-drop Excel upload
- Data preview before processing
- Row validation with error highlighting
- Automatic upsert of salespersons, products, clients

### 🚨 Client Status System
- Statuses: NEW → FOLLOW_UP_1 → FOLLOW_UP_2 → RECOVERED / LOST / CANCELLED
- Reason required for LOST/CANCELLED
- Full status history with timestamps
- Color-coded UI

### 🎨 Modern UI/UX
- Dark/Light mode
- Framer Motion animations
- Recharts for all visualizations
- TanStack Table for sortable/filterable/paginated tables
- ShadCN UI components

## 🚀 Getting Started

### 1. Set up Supabase

1. Create a project at [supabase.com](https://supabase.com)
2. Run the SQL schema in `supabase/schema.sql` in the Supabase SQL Editor
3. Enable Email auth in Authentication settings

### 2. Configure Environment

Copy `.env.local` and fill in your Supabase credentials:

```env
NEXT_PUBLIC_SUPABASE_URL=your_project_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

### 3. Install & Run

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

## 📁 Project Structure

```
src/
├── app/
│   ├── (app)/             # Protected app routes
│   │   ├── dashboard/     # Main dashboard
│   │   ├── clients/       # Client management
│   │   ├── analytics/     # Advanced analytics
│   │   ├── admin/         # Admin panel
│   │   └── sales/         # Sales rep dashboard
│   ├── login/             # Authentication
│   └── layout.tsx
├── components/
│   ├── ui/               # ShadCN-style UI components
│   ├── layout/           # Sidebar, Navbar
│   ├── dashboard/        # KPI cards, charts, insights
│   ├── clients/          # Status/note dialogs
│   ├── admin/            # Excel upload, user mgmt, logs
│   └── shared/           # FilterBar
├── lib/
│   ├── supabase/         # Client + Server Supabase clients
│   └── utils.ts          # Utility functions
├── store/
│   └── useStore.ts       # Zustand global state
├── types/
│   └── database.ts       # TypeScript types for all tables
└── i18n/
    └── messages/         # en.json + ar.json translations
```

## 🗃️ Database Schema

Key tables:
- **users** - App users with roles (admin/sales)
- **salespersons** - Salesperson profiles with codes
- **products** - Cartela product types
- **clients** - Customer/partner accounts
- **orders** - Individual Cartela orders (computed level: RED/ORANGE/GREEN)
- **client_status_history** - Full audit trail of status changes
- **activity_logs** - System-wide activity tracking
- **upload_batches** - Excel upload records

## 🎯 Business Logic

- **RED** (0 meters): No orders — critical, shown first in sales dashboard
- **ORANGE** (< 100 meters): Low volume — warning
- **GREEN** (≥ 100 meters): Healthy orders

## Tech Stack

| Layer | Technology |
|-------|------------|
| Framework | Next.js 14 (App Router) |
| Language | TypeScript |
| Styling | Tailwind CSS |
| UI Components | ShadCN / Radix UI |
| Animations | Framer Motion |
| Charts | Recharts |
| Tables | TanStack Table |
| State | Zustand |
| Backend | Supabase (PostgreSQL + Auth + Realtime) |
| i18n | Built-in cookie-based locale |
| File Upload | react-dropzone + xlsx |
| Export | xlsx + jsPDF |
