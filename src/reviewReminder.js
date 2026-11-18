// Backwards-compatible keys preserve receipts for reminders queued before this release.
export function reviewReminderKey(row){
 return row.reminder_key||`review-reminder:${row.id}:${row.snoozed_until}`;
}
