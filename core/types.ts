export type SaleChannel = "walk-in" | "whatsapp" | "instagram" | "online" | "phone";
export type PaymentMethod = "cash" | "mpesa" | "card";
export type PaymentStatus = "confirmed" | "pending";
export type OrderStatus = "new" | "paid" | "fulfilled" | "cancelled";

export interface Product {
  productId: string;
  name: string;
  sku: string;
  priceCents: number;
  costCents: number;
  stock: number;
  lowStockAt: number;
  active: boolean;
  updatedAt: string;
}

export interface SaleLine {
  productId: string;
  name: string;
  qty: number;
  unitPriceCents: number;
  unitCostCents: number;
}

export interface SalePayment {
  method: PaymentMethod;
  amountCents: number;
  status: PaymentStatus;
  reference?: string;
}

export interface Sale {
  saleId: string;
  channel: SaleChannel;
  lines: SaleLine[];
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  totalCents: number;
  costCents: number;
  payments: SalePayment[];
  customerName?: string;
  customerPhone?: string;
  businessDate: string;
  createdAt: string;
  orderId?: string;
  refunded?: boolean;
}

export interface OrderLine {
  productId: string;
  name: string;
  qty: number;
  unitPriceCents: number;
  unitCostCents: number;
}

export interface Order {
  orderId: string;
  channel: SaleChannel;
  customerName: string;
  customerPhone?: string;
  lines: OrderLine[];
  totalCents: number;
  status: OrderStatus;
  createdAt: string;
  note?: string;
}

export interface Expense {
  expenseId: string;
  category: string;
  amountCents: number;
  note: string;
  businessDate: string;
  createdAt: string;
}

export interface PaymentRecord {
  paymentId: string;
  saleId?: string;
  method: PaymentMethod;
  amountCents: number;
  status: PaymentStatus;
  reference?: string;
  businessDate: string;
  createdAt: string;
}

export type EventType =
  | "device.paired"
  | "product.created"
  | "product.updated"
  | "stock.adjusted"
  | "sale.completed"
  | "sale.refunded"
  | "order.created"
  | "order.paid"
  | "order.fulfilled"
  | "order.cancelled"
  | "payment.recorded"
  | "expense.recorded"
  | "day.closed"
  | "license.activated";

export interface LedgerEvent {
  id: string;
  deviceId: string;
  seq: number;
  lamport: number;
  type: EventType;
  payload: Record<string, unknown>;
  createdAt: string;
  idempotencyKey: string;
  prevHash: string;
  hash: string;
}

export interface DayTotal {
  businessDate: string;
  salesCents: number;
  costCents: number;
  grossProfitCents: number;
  discountCents: number;
  taxCents: number;
  cashInCents: number;
  pendingCents: number;
  expensesCents: number;
  netCashCents: number;
  salesCount: number;
}

export interface TopProduct {
  productId: string;
  name: string;
  qty: number;
  revenueCents: number;
}

export interface Projection {
  products: Product[];
  sales: Sale[];
  orders: Order[];
  payments: PaymentRecord[];
  expenses: Expense[];
  days: Record<string, DayTotal>;
  topProducts: TopProduct[];
  lowStock: Product[];
  pendingOrders: Order[];
  cashPositionCents: number;
  totalSalesCents: number;
  vector: Record<string, number>;
  lastEventAt: string | null;
}

export interface BriefMetric {
  label: string;
  value: string;
  tone?: "good" | "warn" | "neutral";
}

export interface Brief {
  businessDate: string;
  title: string;
  text: string;
  metrics: BriefMetric[];
  actions: string[];
  generatedAt: string;
}

export interface LicensePayload {
  licenseId: string;
  shop: string;
  deviceLimit: number;
  issuedAt: string;
  expiresAt: string;
  features: string[];
}

export interface SignedLicense {
  payload: LicensePayload;
  signature: string;
}

export interface LicenseStatus {
  mode: "community" | "licensed" | "expired" | "invalid" | "missing";
  shop?: string;
  expiresAt?: string;
  deviceLimit?: number;
  features?: string[];
  message: string;
}

export interface DeviceMeta {
  deviceId: string;
  deviceName: string;
  createdAt: string;
  pairingCode: string;
  lastSeq: number;
}

export interface SyncResult {
  pulled: number;
  pushed: number;
  accepted: number;
  skipped: number;
  gaps: Array<{ deviceId: string; expected: number; got: number }>;
}
