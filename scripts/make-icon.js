// Generates assets/icon.png and assets/adaptive-icon.png
// Run: node scripts/make-icon.js
const sharp = require('sharp');
const path = require('path');

const ASSETS = path.join(__dirname, '../assets');

// Book is sized to fill ~65% of the canvas so Android's circular / squircle
// crop has comfortable padding on all sides.  Corners of the book sit ~320 px
// from centre — well inside the 341 px adaptive-icon safe-zone radius.
const bookSvg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
  <defs>
    <radialGradient id="glow" cx="50%" cy="50%" r="40%">
      <stop offset="0%"   stop-color="#251908" stop-opacity="1"/>
      <stop offset="100%" stop-color="#0D0C09" stop-opacity="1"/>
    </radialGradient>
    <linearGradient id="coverSheen" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%"   stop-color="#000000" stop-opacity="0.28"/>
      <stop offset="16%"  stop-color="#ffffff" stop-opacity="0.05"/>
      <stop offset="100%" stop-color="#000000" stop-opacity="0.12"/>
    </linearGradient>
    <linearGradient id="spineGrad" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%"   stop-color="#5C3F0A"/>
      <stop offset="100%" stop-color="#7C5A1A"/>
    </linearGradient>
  </defs>

  <!-- Dark background -->
  <rect width="1024" height="1024" fill="#0D0C09"/>
  <!-- Warm amber glow centred behind the book -->
  <rect width="1024" height="1024" fill="url(#glow)"/>

  <!-- Page block — three depth layers (right of cover) -->
  <rect x="658" y="273" width="48"  height="478" rx="6" fill="#8A7850" opacity="0.38"/>
  <rect x="662" y="281" width="34"  height="462" rx="5" fill="#B09868" opacity="0.62"/>
  <rect x="667" y="289" width="20"  height="446" rx="4" fill="#EDE0CC" opacity="0.86"/>

  <!-- Drop shadow beneath book -->
  <ellipse cx="488" cy="774" rx="185" ry="14" fill="#000000" opacity="0.28"/>

  <!-- Book cover  (360 × 500, centred at ~488, 512) -->
  <rect x="308" y="262" width="350" height="500" rx="16" fill="#C8A84B"/>
  <!-- Depth sheen on cover -->
  <rect x="308" y="262" width="350" height="500" rx="16" fill="url(#coverSheen)"/>

  <!-- Spine (leftmost 58 px of cover) -->
  <rect x="308" y="262" width="58"  height="500" rx="14" fill="url(#spineGrad)"/>
  <!-- Spine / cover seam line -->
  <rect x="362" y="266" width="2"   height="492" fill="#000000" opacity="0.14"/>

  <!-- Top & bottom binding strips -->
  <rect x="308" y="262" width="350" height="9"   rx="7"  fill="#ffffff" opacity="0.05"/>
  <rect x="308" y="751" width="350" height="9"   rx="7"  fill="#000000" opacity="0.10"/>

  <!-- Decorative top horizontal rule -->
  <rect x="382" y="342" width="240" height="5"   rx="2.5" fill="#8A6820" opacity="0.55"/>
  <!-- Short sub-rule -->
  <rect x="382" y="357" width="152" height="3.5" rx="1.75" fill="#8A6820" opacity="0.36"/>

  <!-- Simulated title text lines -->
  <rect x="382" y="388" width="222" height="13"  rx="5"   fill="#8A6820" opacity="0.46"/>
  <rect x="382" y="408" width="240" height="11"  rx="4.5" fill="#8A6820" opacity="0.36"/>
  <rect x="382" y="427" width="180" height="10"  rx="4"   fill="#8A6820" opacity="0.28"/>

  <!-- Centre diamond ornament -->
  <rect x="468" y="510" width="38" height="38" rx="7"
        fill="#8A6820" opacity="0.40"
        transform="rotate(45 487 529)"/>

  <!-- Bottom horizontal rule -->
  <rect x="382" y="638" width="240" height="5"   rx="2.5" fill="#8A6820" opacity="0.55"/>
  <!-- Author name stub -->
  <rect x="406" y="653" width="144" height="3.5" rx="1.75" fill="#8A6820" opacity="0.33"/>
</svg>`;

// Adaptive icon: strip the flat background — OS supplies the masked background layer
const adaptiveSvg = bookSvg
  .replace('<rect width="1024" height="1024" fill="#0D0C09"/>\n', '')
  .replace('<rect width="1024" height="1024" fill="url(#glow)"/>\n', '');

async function main() {
  await sharp(Buffer.from(bookSvg))
    .resize(1024, 1024)
    .png()
    .toFile(path.join(ASSETS, 'icon.png'));
  console.log('✓ assets/icon.png');

  await sharp(Buffer.from(adaptiveSvg))
    .resize(1024, 1024)
    .png()
    .toFile(path.join(ASSETS, 'adaptive-icon.png'));
  console.log('✓ assets/adaptive-icon.png');

  console.log('\nDone! Commit the PNG files then rebuild the APK.');
}

main().catch((e) => { console.error(e); process.exit(1); });
