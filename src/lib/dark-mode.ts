// Forces a dark theme onto the current page: dark grey background, near-white text.
// Toggled from the popup ("Dark mode"); lasts until toggled off or the page reloads.

const STYLE_ID = "jtc-dark-mode";

const BACKGROUND = "#1e1e1e";
const SURFACE = "#2a2a2a"; // form fields and buttons, so they stand out from the page
const TEXT = "#ececec";
const MUTED = "#a8a8a8";
const BORDER = "#4a4a4a";
const LINK = "#8ab4f8";

// Pages paint backgrounds on many nested elements (cards, sections, wrappers), so everything
// under <body> goes transparent and only the page itself and form controls get a colour.
// Images, video and canvas are left alone.
const CSS = `
  html, body {
    background: ${BACKGROUND} !important;
    color: ${TEXT} !important;
    color-scheme: dark !important;
  }
  body *:not(img):not(video):not(canvas):not(svg):not(svg *) {
    background-color: transparent !important;
    color: ${TEXT} !important;
    border-color: ${BORDER} !important;
    box-shadow: none !important;
  }
  body input, body textarea, body select, body button, body option,
  body [role="option"], body [role="listbox"], body [class*="menu"] {
    background-color: ${SURFACE} !important;
  }
  body a, body a * {
    color: ${LINK} !important;
  }
  body ::placeholder {
    color: ${MUTED} !important;
  }
  body svg:not([fill]) {
    fill: currentColor;
  }
`;

export function isDarkMode(): boolean {
  return !!document.getElementById(STYLE_ID);
}

/** Turns forced dark mode on or off for this frame. Returns the new state. */
export function toggleDarkMode(): boolean {
  const existing = document.getElementById(STYLE_ID);

  if (existing) {
    existing.remove();
    return false;
  }
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = CSS;
  // Appended to <html> after <head>, so it comes after (and wins over) the page's own styles.
  document.documentElement.append(style);
  return true;
}
