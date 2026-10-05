export interface Court {
  id: string;
  name: string;
}

export interface Booking {
  id: string;
  courtId: string;
  /** Local date, YYYY-MM-DD */
  date: string;
  /** Start hour, 0-23. Each slot is one hour long. */
  hour: number;
  userId: string;
  userName: string;
  createdAt: string;
}

export type NewBooking = Pick<Booking, 'courtId' | 'date' | 'hour'>;

export interface User {
  id: string;
  name: string;
  email: string;
}
