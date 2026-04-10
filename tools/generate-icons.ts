import { $ } from "bun";

const sizes = [16, 32, 48, 128];

for (const size of sizes) {
  const fontSize = Math.round(size * 0.75);
  const offset = Math.round(size * 0.8);

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <text x="50%" y="${offset}" font-size="${fontSize}" font-family="Apple Color Emoji, Segoe UI Emoji, Noto Color Emoji" text-anchor="middle">🎮</text>
</svg>`;

  const svgPath = `/tmp/icon-${size}.svg`;
  const pngPath = `icons/icon-${size}.png`;

  await Bun.write(svgPath, svg);
  await $`rsvg-convert -w ${size} -h ${size} -f png ${svgPath} -o ${pngPath}`;
  console.log(`Generated ${pngPath}`);
}
