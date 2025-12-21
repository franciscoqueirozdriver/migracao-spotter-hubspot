
export interface SpotterOrganization {
  id: number;
  name: string;
  website?: string | null;
  phone?: string | null;
  industry?: string | null;
  subIndustry?: string | null;
  employees?: number | null;
  revenue?: number | null;
  // Add other relevant fields if needed
}

export interface SpotterLead {
  id: number;
  organizationId?: number | null;
  stage?: string | null;
  source?: string | null;
  value?: number | null;
  userId?: number | null;
  pipeline?: string | null;
  creationDate?: string | null;
  // Add other relevant fields
}

export interface SpotterPerson {
  id: number;
  email?: string | null;
  name?: string | null;
  linkedIn?: string | null;
  phone?: string | null;
  role?: string | null;
  leadId?: number | null; // Often associated with a lead
  mainContact?: boolean | null;
}

export type DiscardReason = 'LEAD_NOT_FOUND' | 'LEAD_STAGE_DISCARDED' | 'LEAD_NO_ORG_ID' | 'ORG_NOT_FOUND_FOR_LEAD';

export interface AuditTotals {
  run_id: string;
  timestamp_utc: string;

  // Leads Sold (Target for migration)
  leads_sold_total: number;
  leads_sold_unique_leadIds: number;

  // Leads Resolution
  leads_found: number;
  leads_missing: number;
  leads_discarded_by_reason: Record<DiscardReason, number>;

  // Organizations Resolution
  unique_org_ids_from_valid_leads: number;
  orgs_found: number;
  orgs_missing: number;

  // Final Export Counts
  final_export_organizations_sold_count: number;

  // Samples for debugging
  samples_missing_org_ids: number[];
  samples_missing_lead_ids: number[];
}

export interface ExportResult<T> {
  items: T[];
  count: number;
  file: string;
}
