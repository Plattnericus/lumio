// Hand-rolled line icons, 24x24, stroke = currentColor. No icon font, no
// emoji - real per-type SVGs as specified.

export const iconBrand = `
<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  <circle cx="12" cy="12" r="4.5" fill="currentColor"/>
  <g stroke="currentColor" stroke-width="1.6" stroke-linecap="round">
    <line x1="12" y1="1.5" x2="12" y2="4.5"/>
    <line x1="12" y1="19.5" x2="12" y2="22.5"/>
    <line x1="1.5" y1="12" x2="4.5" y2="12"/>
    <line x1="19.5" y1="12" x2="22.5" y2="12"/>
    <line x1="4.4" y1="4.4" x2="6.5" y2="6.5"/>
    <line x1="17.5" y1="17.5" x2="19.6" y2="19.6"/>
    <line x1="19.6" y1="4.4" x2="17.5" y2="6.5"/>
    <line x1="6.5" y1="17.5" x2="4.4" y2="19.6"/>
  </g>
</svg>`;

const docBase = (inner) => `
<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M6 2.5h8.5L19 7v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V3.5A1 1 0 0 1 6 2.5Z"
    stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>
  <path d="M14.5 2.5V6a1 1 0 0 0 1 1H19" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>
  ${inner}
</svg>`;

export const iconImage = `
<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect x="3" y="4" width="18" height="16" rx="2" stroke="currentColor" stroke-width="1.4"/>
  <circle cx="8.5" cy="9" r="1.6" stroke="currentColor" stroke-width="1.4"/>
  <path d="M3.5 16.5 8 12a1.5 1.5 0 0 1 2.1 0l1.9 1.9M14 13.5l1.3-1.3a1.5 1.5 0 0 1 2.1 0l3.1 3.1"
    stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

export const iconPdf = docBase(
  `<text x="12" y="16.5" text-anchor="middle" font-size="6.2" font-weight="700" fill="currentColor" font-family="inherit">PDF</text>`
);

export const iconDocx = docBase(
  `<text x="12" y="16.5" text-anchor="middle" font-size="6.2" font-weight="700" fill="currentColor" font-family="inherit">DOC</text>`
);

export const iconPptx = docBase(
  `<text x="12" y="16.5" text-anchor="middle" font-size="5.6" font-weight="700" fill="currentColor" font-family="inherit">PPT</text>`
);

export const iconGeneric = docBase("");

export const iconDownload = `
<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M12 3v12m0 0 4.5-4.5M12 15l-4.5-4.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M4.5 17v2a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
</svg>`;

export const iconTrash = `
<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M5 7h14M9.5 7V5a1.5 1.5 0 0 1 1.5-1.5h2A1.5 1.5 0 0 1 14.5 5v2M7 7l1 12.5a1.5 1.5 0 0 0 1.5 1.4h5a1.5 1.5 0 0 0 1.5-1.4L18 7"
    stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

export const iconLogout = `
<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M9 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h3M16 16l4-4-4-4M20 12H9"
    stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

export const iconWatch = `
<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect x="7" y="7" width="10" height="10" rx="2.5" stroke="currentColor" stroke-width="1.6"/>
  <path d="M9.5 7 8.7 3.5a1 1 0 0 1 1-1.2h4.6a1 1 0 0 1 1 1.2L14.5 7M9.5 17l-.8 3.5a1 1 0 0 0 1 1.2h4.6a1 1 0 0 0 1-1.2L14.5 17"
    stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
  <path d="M12 9.8v2.4l1.6 1.2" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

export const iconUpload = `
<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M12 15V3m0 0 4.5 4.5M12 3 7.5 7.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M4.5 15v4a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
</svg>`;

export const iconClose = `
<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
</svg>`;

export const iconShield = `
<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M12 3l6.5 2.5v5c0 4.5-2.8 7.9-6.5 9.5-3.7-1.6-6.5-5-6.5-9.5v-5L12 3Z"
    stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
  <path d="M9 12.3l2 2 4-4.2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

export const iconShare = `
<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M12 3v12.5M12 3 8 7M12 3l4 4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M6 11v7a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

export const iconUsers = `
<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  <circle cx="9" cy="8" r="3" stroke="currentColor" stroke-width="1.5"/>
  <path d="M3 19.5c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
  <path d="M15.5 5.3a3 3 0 0 1 0 5.8M18.5 19.2c-.1-2.6-1.4-4.4-3.4-5.2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
</svg>`;

export const iconGear = `
<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  <circle cx="12" cy="12" r="3.2" stroke="currentColor" stroke-width="1.5"/>
  <path d="M12 3.5v2.3M12 18.2v2.3M20.5 12h-2.3M5.8 12H3.5M17.7 6.3l-1.6 1.6M7.9 16.1l-1.6 1.6M17.7 17.7l-1.6-1.6M7.9 7.9 6.3 6.3"
    stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
</svg>`;

export const iconLibrary = `
<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect x="3" y="4.5" width="13" height="13" rx="2" stroke="currentColor" stroke-width="1.5"/>
  <path d="M8.5 9.5v4M11.5 8v5.5M14.5 10.5v3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
  <path d="M18.5 7.5v9a2 2 0 0 1-2 2H8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
</svg>`;

export const iconCheck = `
<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  <circle cx="12" cy="12" r="9.5" stroke="currentColor" stroke-width="1.5"/>
  <path d="M7.5 12.3 10.3 15l6.2-6.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

export const iconKey = `
<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  <circle cx="8" cy="15.5" r="4" stroke="currentColor" stroke-width="1.5"/>
  <path d="M11 12.5 18.5 5M15.5 8.5l2 2M18 6l2 2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

const ICONS_BY_EXTENSION = {
  jpg: iconImage,
  png: iconImage,
  webp: iconImage,
  pdf: iconPdf,
  docx: iconDocx,
  pptx: iconPptx,
};

export function iconForExtension(extension) {
  return ICONS_BY_EXTENSION[extension] || iconGeneric;
}
