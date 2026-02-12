/**
 * Shared type definitions for the campaign app
 */

export interface Campaign {
  id: string;
  date: string;
  state: string;
  place: string;
  time: string;
  leader: string;
  mobile: string | null;
  botj: string | null;
  tl_ok: boolean;
  sr_ok: boolean;
  created_at: string;
  source?: string | null;
}
