// These budgets reject incomplete evidence; they never truncate an answer into proof.
// They bound work after the provider/parser returns, not its earlier allocations.
export const REPLY_HEADER_BYTES = 64 * 1024;
export const REPLY_ADDRESS_BYTES = 32 * 1024;
export const REPLY_TEXT_BYTES = 256 * 1024;
const problem = () => Object.assign(Error('team_reply_payload_incomplete'), {code:'team_reply_payload_incomplete', status:502});
function text(value, max) {
 if (value == null) return '';
 if (typeof value !== 'string' || value.length > max || Buffer.byteLength(value, 'utf8') > max) throw problem();
 return value;
}
export function replyAddresses(...values) {
 let bytes = 0, count = 0;
 const result = [];
 for (const value of values) {
  const list = value == null ? [] : Array.isArray(value) ? value : value?.value;
  if (!Array.isArray(list) || list.length > 100 - count) throw problem();
  count += list.length;
  for (const row of list) {
   if (!row || typeof row !== 'object' || Array.isArray(row) || row.group) throw problem();
   const address = text(row?.address, 998);
   bytes += Buffer.byteLength(address, 'utf8');
   if (bytes > REPLY_ADDRESS_BYTES) throw problem();
   if (address.trim()) result.push(address.trim().toLowerCase());
  }
 }
 return result;
}
export function replySourceAvailable(source) {
 if (Buffer.isBuffer(source)) return source.length > 0 && source.length <= 2 * 1024 * 1024;
 return typeof source === 'string' && source.length > 0 && source.length <= 2 * 1024 * 1024 && Buffer.byteLength(source, 'utf8') <= 2 * 1024 * 1024;
}
export function replyHeader(value) {
 if (Buffer.isBuffer(value)) {
  if (value.length > REPLY_HEADER_BYTES) throw problem();
  value = value.toString('utf8');
 }
 return text(value, REPLY_HEADER_BYTES).replace(/\r?\n[ \t]+/g, ' ');
}
export function replyId(value) {
 const id = text(value, 998);
 if (/[\r\n]/.test(id)) throw problem();
 return id;
}
export function replyDate(value) {
 if (value == null) return null;
 if (!(value instanceof Date)) value = text(value, 128);
 const date = new Date(value);
 if (!Number.isFinite(date.getTime())) throw problem();
 return date;
}
export function replyEvidence(full) {
 const message_id = replyId(full?.messageId);
 const date = replyDate(full?.date);
 if (!message_id || !date || date.getTime() > Date.now() + 60000) throw problem();
 return {message_id, at:date.toISOString(), text:text(full.text, REPLY_TEXT_BYTES)};
}
