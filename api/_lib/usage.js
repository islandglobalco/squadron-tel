// api/_lib/usage.js — a business's standing against its prepaid ledger.
// A business is paused when its account has no active paid period, no
// prepaid budget left, or (for voice) no included minutes left.
import { ledgerStatus, accountForBusiness, HOLD } from './ledger.js';

export async function usageFor(businessId) {
  const accountId = await accountForBusiness(businessId);
  const st = await ledgerStatus(accountId);
  const paused = !st.active || st.remainingCents < HOLD.chatTurn;
  const voicePaused = paused || st.minutesRemaining <= 0 || st.remainingCents < HOLD.voicePerMinute;
  return { ...st, accountId, paused, voicePaused };
}
