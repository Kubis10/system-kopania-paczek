import { z } from 'zod';

export const statuses = ['CREATED', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED'] as const;
export type Status = typeof statuses[number];
export const parcelInput = z.object({
  recipientName: z.string().trim().min(3).max(120),
  recipientPhone: z.string().regex(/^\+?[0-9 ()-]{9,20}$/),
  recipientEmail: z.email().max(254),
  recipientAddress: z.string().trim().min(5).max(240),
  city: z.string().trim().min(2).max(80),
  postalCode: z.string().regex(/^\d{2}-\d{3}$/),
  size: z.enum(['S', 'M', 'L']),
  weight: z.number().positive().max(25),
  service: z.enum(['STANDARD', 'EXPRESS']),
  lockerOrPointId: z.string().trim().max(80).optional(),
});
export type ParcelInput = z.infer<typeof parcelInput>;
export const priceFor = (size: ParcelInput['size'], service: ParcelInput['service']) => ({ S: 1490, M: 1890, L: 2490 })[size] + (service === 'EXPRESS' ? 1000 : 0);
export function canTransition(from: Status, to: Status): boolean {
  return statuses.indexOf(to) === statuses.indexOf(from) + 1;
}
export type History = { status: Status; location: string; timestamp: string };
export type PaymentStatus = 'UNPAID' | 'PAID';
export type Parcel = {
  id: string; trackingNumber: string; senderId: string; courierId: string | null;
  recipientName: string; recipientPhone: string; recipientAddress: string;
  recipientEmail: string;
  city: string; postalCode: string; size: ParcelInput['size']; weight: number;
  service: ParcelInput['service']; price: number; paymentStatus: PaymentStatus; paidAt: string | null; status: Status; pickupCodeHash: string;
  createdAt: string; estimatedDelivery: string; history: History[]; lockerOrPointId?: string;
};
export type User = { id: string; email: string; passwordHash: string; role: 'CLIENT' | 'COURIER' | 'ADMIN'; totpSecret: string | null; is2faEnabled: boolean };