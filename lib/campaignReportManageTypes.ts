/** Shapes shared by the Campaign Reports management screen and its API (see lib/services/campaignReportManageService.ts). */

export interface ManageReport {
  id: string;
  submittedAt: string;
  campaignDate: string | null;
  campaignDateRaw: string | null;
  /** The location and leader exactly as typed into the sheet. */
  location: string | null;
  leader: string | null;
  state: string | null;
  place: string | null;
  matchedLeader: string | null;
  partial: number | null;
  full: number | null;
  sinnersPrayer: number | null;
  infoRequests: number | null;
  needsReview: boolean;
}

export interface ManageDataResponse {
  reports: ManageReport[];
  places: { state: string; place: string }[];
  leaders: { state: string; leader: string }[];
}

export type EditableReportField = 'state' | 'place' | 'leader';

export const EDITABLE_REPORT_FIELDS: readonly EditableReportField[] = ['state', 'place', 'leader'];

/** Which campaign_reports column each editable field writes. */
export const REPORT_FIELD_COLUMNS: Record<EditableReportField, 'derived_state' | 'derived_place' | 'derived_leader'> = {
  state: 'derived_state',
  place: 'derived_place',
  leader: 'derived_leader',
};

export interface ReportEditResponse {
  id: string;
  state: string | null;
  place: string | null;
  matchedLeader: string | null;
}

export interface ReportEditLogEntry {
  id: string;
  editedAt: string;
  editedBy: string | null;
  field: string;
  oldValue: string | null;
  newValue: string | null;
  location: string | null;
  leader: string | null;
}

export interface ReportEditLogResponse {
  entries: ReportEditLogEntry[];
  page: number;
  pageSize: number;
  total: number;
}
