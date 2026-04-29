// Generates assets/icon.png and assets/adaptive-icon.png
// Run: node scripts/make-icon.js
const sharp = require('sharp');
const path = require('path');

const ASSETS = path.join(__dirname, '../assets');

const bookSvg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
  <defs>
    <linearGradient id="coverSheen" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%"   stop-color="#000000" stop-opacity="0.30"/>
      <stop offset="18%"  stop-color="#ffffff" stop-opacity="0.04"/>
      <stop offset="100%" stop-color="#000000" stop-opacity="0.12"/>
    </linearGradient>
    <linearGradient id="spineGrad" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%"   stop-color="#6A4E10"/>
      <stop offset="100%" stop-color="#8A6820"/>
    </linearGradient>
  </defs>

  <!-- Background -->
  <rect width="1024" height="1024" fill="#0D0C09"/>

  <!-- Page block — three layers of pages for depth -->
  <rect x="718" y="204" width="78" height="616" rx="7"  fill="#A09070" opacity="0.45"/>
  <rect x="726" y="212" width="58" height="600" rx="6"  fill="#C8B890" opacity="0.70"/>
  <rect x="734" y="220" width="38" height="584" rx="5"  fill="#EDE0CC" opacity="0.92"/>

  <!-- Soft shadow under book -->
  <ellipse cx="490" cy="848" rx="270" ry="22" fill="#000000" opacity="0.35"/>

  <!-- Book cover -->
  <rect x="228" y="192" width="500" height="640" rx="22" fill="#C8A84B"/>

  <!-- Cover sheen (gradient overlay for depth) -->
  <rect x="228" y="192" width="500" height="640" rx="22" fill="url(#coverSheen)"/>

  <!-- Spine -->
  <rect x="228" y="192" width="78" height="640" rx="18" fill="url(#spineGrad)"/>

  <!-- Spine–cover seam -->
  <rect x="300" y="196" width="3"   height="632" fill="#000000" opacity="0.18"/>

  <!-- Top and bottom binding lines -->
  <rect x="228" y="192" width="500" height="14"  rx="10" fill="#ffffff" opacity="0.06"/>
  <rect x="228" y="818" width="500" height="14"  rx="10" fill="#000000" opacity="0.12"/>

  <!-- Decorative top rule -->
  <rect x="326" y="300" width="348" height="7" rx="3.5" fill="#8A6820" opacity="0.60"/>
  <!-- Subtitle rule -->
  <rect x="326" y="322" width="220" height="5" rx="2.5" fill="#8A6820" opacity="0.40"/>

  <!-- Title text blocks -->
  <rect x="326" y="360" width="316" height="18" rx="6" fill="#8A6820" opacity="0.50"/>
  <rect x="326" y="394" width="348" height="16" rx="6" fill="#8A6820" opacity="0.40"/>
  <rect x="326" y="424" width="260" height="15" rx="5" fill="#8A6820" opacity="0.32"/>

  <!-- Centre ornament (rotated square / diamond) -->
  <rect x="462" y="528" width="56" height="56" rx="10" fill="#8A6820" opacity="0.42" transform="rotate(45 490 556)"/>

  <!-- Bottom decorative rule -->
  <rect x="326" y="682" width="348" height="7" rx="3.5" fill="#8A6820" opacity="0.60"/>
  <!-- Author line -->
  <rect x="360" y="714" width="210" height="5" rx="2.5" fill="#8A6820" opacity="0.38"/>
</svg>`;

// Adaptive icon uses transparent background — OS applies the mask/background
const adaptiveSvg = bookSvg.replace(
  '<rect width="1024" height="1024" fill="#0D0C09"/>',
  '',
);

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

  console.log('\nDone! Commit both PNG files then rebuild the APK.');
}

main().catch((e) => { console.error(e); process.exit(1); });
