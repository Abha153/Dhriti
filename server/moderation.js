// First-pass screening for text that will be shown publicly. It rejects personal details outright; everything
// that passes still waits in the moderation queue before it is visible.
export function screenPublicText(text) {
  const t = String(text);
  if (/\+?\d[\d\s().-]{8,}\d/.test(t)) return 'Please remove phone or ID numbers. Public reports must not contain personal details.';
  if (/\S+@\S+\.\S+/.test(t)) return 'Please remove email addresses. Public reports must not contain personal details.';
  if (/https?:\/\/|www\./i.test(t)) return 'Please remove links. Describe the place instead.';
  return null;
}
