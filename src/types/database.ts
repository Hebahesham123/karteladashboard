export type UserRole = "admin" | "sales";
export type ClientStatus =
  | "NEW"
  | "FOLLOW_UP_1"
  | "FOLLOW_UP_2"
  | "RECOVERED"
  | "LOST"
  | "CANCELLED";
export type OrderLevel = "RED" | "ORANGE" | "GREEN" | "INACTIVE";
export type ActivityType =
  | "EXCEL_UPLOAD"
  | "STATUS_CHANGE"
  | "NOTE_ADDED"
  | "CLIENT_CREATED"
  | "USER_CREATED"
  | "USER_UPDATED";

export interface Database {
  public: {
    Tables: {
      users: {
        Row: {
          id: string;
          email: string;
          full_name: string;
          role: UserRole;
          avatar_url: string | null;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["users"]["Row"], "created_at" | "updated_at">;
        Update: Partial<Database["public"]["Tables"]["users"]["Insert"]>;
      };
      salespersons: {
        Row: {
          id: string;
          code: string;
          name: string;
          user_id: string | null;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["salespersons"]["Row"], "id" | "created_at" | "updated_at">;
        Update: Partial<Database["public"]["Tables"]["salespersons"]["Insert"]>;
      };
      products: {
        Row: {
          id: string;
          name: string;
          description: string | null;
          is_active: boolean;
          created_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["products"]["Row"], "id" | "created_at">;
        Update: Partial<Database["public"]["Tables"]["products"]["Insert"]>;
      };
      clients: {
        Row: {
          id: string;
          partner_id: string;
          name: string;
          salesperson_id: string | null;
          current_status: ClientStatus;
          status_reason: string | null;
          notes: string | null;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["clients"]["Row"], "id" | "created_at" | "updated_at">;
        Update: Partial<Database["public"]["Tables"]["clients"]["Insert"]>;
      };
      orders: {
        Row: {
          id: string;
          client_id: string;
          salesperson_id: string | null;
          product_id: string;
          month: number;
          year: number;
          quantity: number;
          order_level: OrderLevel;
          upload_batch_id: string | null;
          invoice_date: string | null;
          invoice_total: number;
          branch: string | null;
          category: string | null;
          invoice_ref: string;
          pricelist: string | null;
          /** JSON [{ label, meters }] from Excel color/variant lines */
          meter_breakdown: { label: string; meters: number }[] | null;
          created_at: string;
        };
        Insert: Omit<
          Database["public"]["Tables"]["orders"]["Row"],
          "id" | "order_level" | "created_at" | "meter_breakdown"
        > & { meter_breakdown?: Database["public"]["Tables"]["orders"]["Row"]["meter_breakdown"] };
        Update: Partial<Database["public"]["Tables"]["orders"]["Insert"]>;
      };
      upload_batches: {
        Row: {
          id: string;
          uploaded_by: string;
          filename: string;
          total_rows: number;
          processed_rows: number;
          failed_rows: number;
          month: number;
          year: number;
          status: string;
          created_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["upload_batches"]["Row"], "id" | "created_at">;
        Update: Partial<Database["public"]["Tables"]["upload_batches"]["Insert"]>;
      };
      client_status_history: {
        Row: {
          id: string;
          client_id: string;
          changed_by: string;
          old_status: ClientStatus | null;
          new_status: ClientStatus;
          reason: string | null;
          note: string | null;
          created_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["client_status_history"]["Row"], "id" | "created_at">;
        Update: Partial<Database["public"]["Tables"]["client_status_history"]["Insert"]>;
      };
      activity_logs: {
        Row: {
          id: string;
          user_id: string | null;
          activity_type: ActivityType;
          entity_type: string | null;
          entity_id: string | null;
          description: string;
          metadata: Record<string, unknown> | null;
          ip_address: string | null;
          created_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["activity_logs"]["Row"], "id" | "created_at">;
        Update: Partial<Database["public"]["Tables"]["activity_logs"]["Insert"]>;
      };
      urgent_order_assignments: {
        Row: {
          id: string;
          order_id: string;
          salesperson_id: string;
          assigned_by: string;
          note: string | null;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["urgent_order_assignments"]["Row"], "id" | "created_at" | "updated_at">;
        Update: Partial<Database["public"]["Tables"]["urgent_order_assignments"]["Insert"]>;
      };
    };
    Views: {
      client_monthly_metrics: {
        Row: {
          client_id: string;
          client_name: string;
          partner_id: string;
          current_status: ClientStatus;
          salesperson_id: string | null;
          salesperson_name: string | null;
          salesperson_code: string | null;
          month: number | null;
          year: number | null;
          total_meters: number;
          unique_products: number;
          level: OrderLevel;
        };
      };
      product_analytics: {
        Row: {
          product_id: string;
          product_name: string;
          month: number | null;
          year: number | null;
          unique_clients: number;
          total_meters: number;
          avg_meters_per_order: number;
          order_count: number;
        };
      };
      salesperson_performance: {
        Row: {
          salesperson_id: string;
          salesperson_name: string;
          salesperson_code: string;
          month: number | null;
          year: number | null;
          active_clients: number;
          total_meters: number;
          unique_products: number;
        };
      };
    };
    Functions: Record<string, never>;
    Enums: {
      user_role: UserRole;
      client_status: ClientStatus;
      order_level: OrderLevel;
      activity_type: ActivityType;
    };
  };
}

// Convenience types
export type User = Database["public"]["Tables"]["users"]["Row"];
export type Salesperson = Database["public"]["Tables"]["salespersons"]["Row"];
export type Product = Database["public"]["Tables"]["products"]["Row"];
export type Client = Database["public"]["Tables"]["clients"]["Row"];
export type Order = Database["public"]["Tables"]["orders"]["Row"];
export type UploadBatch = Database["public"]["Tables"]["upload_batches"]["Row"];
export type ClientStatusHistory = Database["public"]["Tables"]["client_status_history"]["Row"];
export type ActivityLog = Database["public"]["Tables"]["activity_logs"]["Row"];
export type UrgentOrderAssignment = Database["public"]["Tables"]["urgent_order_assignments"]["Row"];
export type ClientMonthlyMetrics = Database["public"]["Views"]["client_monthly_metrics"]["Row"];
export type ProductAnalytics = Database["public"]["Views"]["product_analytics"]["Row"];
export type SalespersonPerformance = Database["public"]["Views"]["salesperson_performance"]["Row"];
