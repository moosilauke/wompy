/** Shape returned by the stats_summary() RPC — migration 0031. */
export interface StatsSummary {
  total_conversations: number;
  total_messages: number;
  busiest_contact_address: string | null;
  busiest_contact_name: string | null;
  busiest_contact_count: number | null;
  longest_thread_id: string | null;
  longest_thread_span_days: number | null;
  longest_thread_partner: string | null;
  longest_thread_partner_name: string | null;
  fastest_reply_seconds: number | null;
  fastest_reply_thread_id: string | null;
  fastest_reply_partner: string | null;
  fastest_reply_partner_name: string | null;
  peak_send_hour: number | null;
  peak_send_hour_count: number | null;
  oldest_ongoing_thread_id: string | null;
  oldest_ongoing_started_at: string | null;
  oldest_ongoing_partner: string | null;
  oldest_ongoing_partner_name: string | null;
  reactions_given: number;
  reactions_received: number;
}
