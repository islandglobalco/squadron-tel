// api/_lib/channels.js — honest per-channel deployment status for a business.

export function channelStatus(biz) {
  const ch = biz.channels || {};
  const origin = process.env.PUBLIC_ORIGIN || 'https://squadron.tel';
  return {
    phone: biz.phone_number
      ? { state: 'live', label: `Live on ${biz.phone_number}`, detail: 'Inbound calls are answered by your team. The AI identifies itself and every call starts with a recording notice.' }
      : { state: 'unavailable', label: 'No number yet', detail: 'Phone numbers are assigned when the phone bridge goes live. Your team is ready; the line is not.' },
    chat: ch.chat && ch.chat.enabled
      ? { state: 'live', label: 'Live', detail: 'The chat widget answers on any page that includes the snippet below.', snippet: `<script src="${origin}/widget.js" data-business="${biz.id}" async></script>` }
      : { state: 'ready', label: 'Ready to turn on', detail: 'Turn chat on, then paste one line into your site.', snippet: `<script src="${origin}/widget.js" data-business="${biz.id}" async></script>` },
    email: { state: 'unavailable', label: 'Not yet available', detail: 'Email answering has not shipped. It will appear here with its own status when it does.' },
    sms: { state: 'unavailable', label: 'Not yet available', detail: 'SMS needs carrier approval (A2P 10DLC) before it can send. It will show "pending carrier approval" once registration is filed.' },
  };
}
