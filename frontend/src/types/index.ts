export interface User {
  id: number;
  username: string;
  role: string;
}

export interface Trip {
  id: number;
  name: string;
  trip_date: string;
  trip_cost_usd?: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
  pilgrim_count?: number;
  total_received?: number;
  total_outstanding?: number;
  net_trip?: number;
  pilgrims?: Pilgrim[];
}

export interface Pilgrim {
  id: number;
  trip_id: number;
  full_name: string;
  nationality: string;
  passport_number: string;
  visa_number: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  total_received?: number;
  payment_count?: number;
  payment_status?: string;
  payments?: Payment[];
}

export interface CashDenomination {
  id: number;
  payment_id: number;
  denomination: number;
  quantity: number;
  subtotal: number;
  created_at: string;
}

export interface Payment {
  id: number;
  pilgrim_id: number;
  amount_usd: number;
  payment_method: 'نقدًا' | 'شام كاش';
  payment_date: string;
  transaction_reference: string | null;
  notes: string | null;
  created_at: string;
  cash_denominations?: CashDenomination[];
  full_name?: string;
  nationality?: string;
  trip_name?: string;
}

export interface AuthResponse {
  token: string;
  user: User;
}

export interface DashboardStats {
  totalTrips: number;
  totalPilgrims: number;
  totalReceived: number;
  totalOutstanding: number;
  fullyPaid: number;
  partiallyPaid: number;
  unpaid: number;
  upcomingTrips: number;
  previousTrips: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}
