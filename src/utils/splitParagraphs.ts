// Splits plain text on blank lines into trimmed, non-empty paragraphs -
// shared by ScrollGatedViewer.tsx and HelpPage.tsx, both of which render
// onboarding_content's plain-text terms_text/privacy_text the same way.
export function splitParagraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
}
