// Generates assets/icon.png and assets/adaptive-icon.png
// Run: node scripts/make-icon.js
const sharp = require('sharp');
const path = require('path');

const ASSETS = path.join(__dirname, '../assets');

// Full icon SVG (dark background baked in, used for icon.png)
const iconSvg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
  <!-- Background -->
  <rect width="1024" height="1024" fill="#0D0C09" rx="200"/>

  <!-- Warm glow behind books -->
  <ellipse cx="512" cy="512" rx="310" ry="340" fill="#C8A84B" opacity="0.07"/>

  <!-- LEFT BOOK -->
  <!-- Cover -->
  <rect x="182" y="188" width="208" height="648" rx="14" fill="#C8A84B"/>
  <!-- Spine shadow -->
  <rect x="362" y="188" width="22" height="648" rx="4" fill="#0D0C09" opacity="0.25"/>
  <!-- Page block -->
  <rect x="370" y="194" width="14" height="636" rx="3" fill="#EDE0CC" opacity="0.9"/>
  <!-- Horizontal lines (pages detail) -->
  <line x1="210" y1="310" x2="355" y2="310" stroke="#A88828" stroke-width="5" stroke-linecap="round" opacity="0.35"/>
  <line x1="210" y1="355" x2="355" y2="355" stroke="#A88828" stroke-width="5" stroke-linecap="round" opacity="0.35"/>
  <line x1="210" y1="400" x2="355" y2="400" stroke="#A88828" stroke-width="5" stroke-linecap="round" opacity="0.35"/>
  <line x1="210" y1="445" x2="355" y2="445" stroke="#A88828" stroke-width="5" stroke-linecap="round" opacity="0.35"/>

  <!-- RIGHT BOOK -->
  <!-- Page block (left side) -->
  <rect x="640" y="194" width="14" height="636" rx="3" fill="#EDE0CC" opacity="0.9"/>
  <!-- Spine shadow -->
  <rect x="640" y="188" width="22" height="648" rx="4" fill="#0D0C09" opacity="0.25"/>
  <!-- Cover -->
  <rect x="634" y="188" width="208" height="648" rx="14" fill="#C8A84B"/>
  <!-- Spine highlight -->
  <rect x="634" y="188" width="14" height="648" rx="4" fill="#EDE0CC" opacity="0.15"/>
  <!-- Horizontal lines -->
  <line x1="669" y1="310" x2="824" y2="310" stroke="#A88828" stroke-width="5" stroke-linecap="round" opacity="0.35"/>
  <line x1="669" y1="355" x2="824" y2="355" stroke="#A88828" stroke-width="5" stroke-linecap="round" opacity="0.35"/>
  <line x1="669" y1="400" x2="824" y2="400" stroke="#A88828" stroke-width="5" stroke-linecap="round" opacity="0.35"/>
  <line x1="669" y1="445" x2="824" y2="445" stroke="#A88828" stroke-width="5" stroke-linecap="round" opacity="0.35"/>

  <!-- EXCHANGE ARROWS (centre gap between books) -->
  <!-- → top arrow -->
  <polyline points="448,432 576,432" stroke="#EDE0CC" stroke-width="24" stroke-linecap="round" fill="none"/>
  <polyline points="550,405 576,432 550,459" stroke="#EDE0CC" stroke-width="24" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
  <!-- ← bottom arrow -->
  <polyline points="576,592 448,592" stroke="#EDE0CC" stroke-width="24" stroke-linecap="round" fill="none"/>
  <polyline points="474,565 448,592 474,619" stroke="#EDE0CC" stroke-width="24" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
</svg>`;

// Adaptive icon foreground: same graphic, transparent background
const adaptiveSvg = iconSvg.replace(
  '<rect width="1024" height="1024" fill="#0D0C09" rx="200"/>',
  '<rect width="1024" height="1024" fill="transparent" rx="200"/>',
);

async function main() {
  await sharp(Buffer.from(iconSvg)).resize(1024, 1024).png().toFile(path.join(ASSETS, 'icon.png'));
  console.log('✓ assets/icon.png');

  await sharp(Buffer.from(adaptiveSvg)).resize(1024, 1024).png().toFile(path.join(ASSETS, 'adaptive-icon.png'));
  console.log('✓ assets/adaptive-icon.png');

  console.log('\nDone! Commit both files then rebuild the APK.');
}

main().catch((e) => { console.error(e); process.exit(1); });
