// The HUD's icons, drawn: glossy cartoon art (SVG with gradients, a dark outline and a white shine), made once
// at load and set as CSS classes (.ic-spin, .ic-rebirth...). The menu never shows an emoji.
const O = '#1a1030';
const svg = (body, defs) => `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'><defs>${defs || ''}</defs>${body}</svg>`;
const grad = (id, stops, x2, y2) => `<linearGradient id='${id}' x1='0' y1='0' x2='${x2 ?? 0}' y2='${y2 ?? 1}'>${stops.map((c, i) => `<stop offset='${i / (stops.length - 1)}' stop-color='${c}'/>`).join('')}</linearGradient>`;
const shine = (cx, cy, rx, ry, rot) => `<ellipse cx='${cx}' cy='${cy}' rx='${rx}' ry='${ry}' fill='#fff' opacity='.5'${rot ? ` transform='rotate(${rot} ${cx} ${cy})'` : ''}/>`;
const f = (n) => +n.toFixed(2);

function wheel() {
    const C = ['#ff4a6a', '#ffa82a', '#ffe02a', '#46ec50', '#3ab4ff', '#8a5aff', '#ff5ac0', '#2ae8d8'];
    let p = '';
    for (let i = 0; i < 8; i++) {
        const a0 = i / 8 * Math.PI * 2 - Math.PI / 2, a1 = (i + 1) / 8 * Math.PI * 2 - Math.PI / 2;
        p += `<path d='M32 34 L${f(32 + 25 * Math.cos(a0))} ${f(34 + 25 * Math.sin(a0))} A25 25 0 0 1 ${f(32 + 25 * Math.cos(a1))} ${f(34 + 25 * Math.sin(a1))} Z' fill='${C[i]}'/>`;
    }
    return svg(`<circle cx='32' cy='34' r='27' fill='${O}'/>${p}<circle cx='32' cy='34' r='25' fill='none' stroke='#fff' stroke-opacity='.35' stroke-width='2'/>
        ${shine(24, 22, 12, 6, -30)}<circle cx='32' cy='34' r='7' fill='url(#g)' stroke='${O}' stroke-width='3'/>
        <path d='M25 2 L39 2 L32 14 Z' fill='#ff3a4a' stroke='${O}' stroke-width='3' stroke-linejoin='round'/>`, grad('g', ['#fff6a0', '#ffb21e']));
}
const ICONS = {
    spin: wheel(),
    // rebirth: two arrows chasing each other round a gold star, on a blue orb
    rebirth: svg(`<circle cx='32' cy='32' r='27' fill='url(#b)' stroke='${O}' stroke-width='4'/>
        <path d='M17 30 A15 15 0 0 1 43 20' fill='none' stroke='#fff' stroke-width='6' stroke-linecap='round'/><path d='M38 13 L49 17 L42 27 Z' fill='#fff'/>
        <path d='M47 34 A15 15 0 0 1 21 44' fill='none' stroke='#fff' stroke-width='6' stroke-linecap='round'/><path d='M26 51 L15 47 L22 37 Z' fill='#fff'/>
        <path d='M32 24 L34.4 29.6 L40.4 30 L35.8 34 L37.2 40 L32 36.8 L26.8 40 L28.2 34 L23.6 30 L29.6 29.6 Z' fill='url(#y)' stroke='${O}' stroke-width='2' stroke-linejoin='round'/>
        ${shine(23, 16, 10, 5, -30)}`, grad('b', ['#8ae6ff', '#1f6fff']) + grad('y', ['#fff6a0', '#ffb21e'])),
    // aura: a purple flame
    aura: svg(`<path d='M32 3 C41 17 54 24 51 41 C49 55 39 61 32 61 C21 61 11 53 13 39 C14 30 21 26 21 17 C27 23 28 29 30 32 C34 24 35 13 32 3 Z' fill='url(#p)' stroke='${O}' stroke-width='4' stroke-linejoin='round'/>
        <path d='M32 30 C37 37 43 41 41 49 C40 55 36 57 32 57 C26 57 22 52 23 46 C24 41 28 40 28 35 C30 38 31 40 32 41 C34 37 34 34 32 30 Z' fill='url(#q)'/>
        ${shine(25, 30, 4, 9, 20)}`, grad('p', ['#ffa8ff', '#b84aff', '#6a1ad8']) + grad('q', ['#ffffff', '#ffd0ff'])),
    // a gift: a red box, a gold ribbon and bow
    gift: svg(`<path d='M20 16 C14 6 26 4 31 16 Z M44 16 C50 6 38 4 33 16 Z' fill='url(#y)' stroke='${O}' stroke-width='3.5' stroke-linejoin='round'/>
        <rect x='10' y='29' width='44' height='30' rx='3' fill='url(#r)' stroke='${O}' stroke-width='4'/>
        <rect x='6' y='17' width='52' height='14' rx='3' fill='url(#r2)' stroke='${O}' stroke-width='4'/>
        <rect x='27' y='17' width='10' height='42' fill='url(#y)' stroke='${O}' stroke-width='3'/>
        ${shine(17, 22, 7, 2.5)}`, grad('r', ['#ff6a7a', '#d81a3a']) + grad('r2', ['#ff8a9a', '#ff2a4a']) + grad('y', ['#fff6a0', '#ffb21e'])),
    // trails: a sneaker speeding along a rainbow
    trail: svg(`<path d='M2 24 L26 24' stroke='#ff4a6a' stroke-width='5' stroke-linecap='round'/><path d='M4 32 L24 32' stroke='#ffd028' stroke-width='5' stroke-linecap='round'/><path d='M2 40 L24 40' stroke='#3ab4ff' stroke-width='5' stroke-linecap='round'/>
        <path d='M22 46 L23 20 Q30 15 36 22 L44 31 Q58 32 61 41 L61 47 Z' fill='url(#r)' stroke='${O}' stroke-width='4' stroke-linejoin='round'/>
        <rect x='21' y='44' width='41' height='8' rx='3' fill='#fff' stroke='${O}' stroke-width='3.5'/>
        <path d='M30 25 L35 23 M33 30 L38 28 M37 34 L42 32' stroke='#fff' stroke-width='2.5' stroke-linecap='round'/>
        ${shine(30, 22, 5, 2.5, -30)}`, grad('r', ['#ff7a8a', '#e8183c'])),
    // worlds: a little globe
    world: svg(`<circle cx='32' cy='32' r='27' fill='url(#s)' stroke='${O}' stroke-width='4'/>
        <path d='M14 22 C20 16 28 18 30 24 C32 30 24 32 22 38 C20 44 13 40 11 34 C10 29 11 25 14 22 Z' fill='url(#l)'/>
        <path d='M36 12 C44 12 52 18 54 26 C50 30 44 26 40 30 C36 34 40 42 36 48 C32 46 31 38 34 32 C36 26 32 22 34 16 Z' fill='url(#l)'/>
        <path d='M26 50 C30 48 36 50 38 55 C33 58 28 57 24 55 Z' fill='url(#l)'/>
        ${shine(22, 17, 10, 5, -30)}`, grad('s', ['#7ae0ff', '#1f7fe8']) + grad('l', ['#a8ff7a', '#22b83a'])),
    // quests: a clipboard with a tick
    quest: svg(`<rect x='10' y='8' width='44' height='52' rx='5' fill='url(#w)' stroke='${O}' stroke-width='4'/>
        <rect x='16' y='16' width='32' height='38' rx='2' fill='#fffdf4' stroke='${O}' stroke-width='2.5'/>
        <rect x='22' y='4' width='20' height='10' rx='3' fill='url(#m)' stroke='${O}' stroke-width='3.5'/>
        <path d='M21 33 L28 40 L43 24' fill='none' stroke='#22c73a' stroke-width='6' stroke-linecap='round' stroke-linejoin='round'/>
        <path d='M22 47 L42 47' stroke='#c8c0d8' stroke-width='3' stroke-linecap='round'/>`, grad('w', ['#e8a868', '#a8602a']) + grad('m', ['#e0e4ee', '#8a90a8'])),
    // settings: a gear
    gear: svg(`<g fill='url(#m)' stroke='${O}' stroke-width='3.5' stroke-linejoin='round'>${[0, 45, 90, 135, 180, 225, 270, 315].map((a) => `<rect x='26' y='3' width='12' height='16' rx='3' transform='rotate(${a} 32 32)'/>`).join('')}<circle cx='32' cy='32' r='20'/></g>
        <circle cx='32' cy='32' r='8' fill='#5a5070' stroke='${O}' stroke-width='3.5'/>${shine(25, 22, 7, 3.5, -30)}`, grad('m', ['#f0f2f8', '#8a90a8'])),
    // the shop: a pink shopping bag with a gold star
    shop: svg(`<path d='M22 22 C22 8 42 8 42 22' fill='none' stroke='${O}' stroke-width='5' stroke-linecap='round'/>
        <path d='M10 20 L54 20 L50 60 L14 60 Z' fill='url(#p)' stroke='${O}' stroke-width='4' stroke-linejoin='round'/>
        <path d='M32 29 L35 36 L42.5 36.6 L36.8 41.4 L38.6 48.8 L32 44.8 L25.4 48.8 L27.2 41.4 L21.5 36.6 L29 36 Z' fill='url(#y)' stroke='${O}' stroke-width='2.5' stroke-linejoin='round'/>
        ${shine(19, 28, 4, 7)}`, grad('p', ['#ffa8e0', '#ff2a9a']) + grad('y', ['#fff6a0', '#ffb21e'])),
    // a Shard: a jagged sliver of glass
    shard: svg(`<path d='M34 3 L52 22 L44 60 L18 54 L9 26 Z' fill='url(#g)' stroke='${O}' stroke-width='4' stroke-linejoin='round'/>
        <path d='M34 8 L27 28 L42 55' fill='none' stroke='#fff' stroke-width='3' stroke-linecap='round' stroke-linejoin='round' stroke-opacity='.85'/>`, grad('g', ['#f0feff', '#7ae8ff', '#2a8aff'], 1, 1)),
    // Speed: an electric bolt
    bolt: svg(`<path d='M38 3 L13 37 L29 37 L24 61 L52 24 L35 24 Z' fill='url(#g)' stroke='${O}' stroke-width='4' stroke-linejoin='round'/>`, grad('g', ['#f4ffff', '#6ae8ff', '#2a7aff'])),
    // Glass Rush: a pane with a crack and a flag
    rush: svg(`<rect x='8' y='8' width='48' height='48' rx='5' fill='url(#g)' stroke='${O}' stroke-width='4'/>
        <path d='M30 28 L14 12 M30 28 L50 14 M30 28 L12 44 M30 28 L36 52 M30 28 L52 36 M20 20 L33 12 M17 40 L28 46' stroke='#fff' stroke-width='3' stroke-linecap='round'/>`, grad('g', ['#a8f0ff', '#2a8aff'])),
    // auto run: a sneaker with motion lines
    auto: svg(`<path d='M4 22 L18 22 M6 30 L16 30 M4 38 L15 38' stroke='#fff' stroke-width='4' stroke-linecap='round'/>
        <path d='M14 46 L15 22 Q22 18 28 24 L36 32 Q52 33 56 42 L56 47 Z' fill='url(#r)' stroke='${O}' stroke-width='4' stroke-linejoin='round'/>
        <rect x='13' y='44' width='45' height='8' rx='3' fill='#fff' stroke='${O}' stroke-width='3.5'/>`, grad('r', ['#7ad8ff', '#1f6fff'])),
    // a Gem
    gem: svg(`<path d='M14 10 L50 10 L61 26 L32 58 L3 26 Z' fill='url(#g)' stroke='${O}' stroke-width='4' stroke-linejoin='round'/>
        <path d='M3 26 L61 26 M14 10 L22 26 L32 58 L42 26 L50 10 M22 26 L32 10 L42 26' fill='none' stroke='#fff' stroke-opacity='.45' stroke-width='2'/>
        ${shine(20, 17, 6, 3, -20)}`, grad('g', ['#e8b8ff', '#9a4aff', '#6a1ad8'])),
};
export function installIcons() {
    const st = document.createElement('style');
    st.textContent = Object.entries(ICONS).map(([k, s]) => `.ic-${k}{background-image:url("data:image/svg+xml,${encodeURIComponent(s.replace(/\s*\n\s*/g, ''))}")}`).join('\n');
    document.head.appendChild(st);
}
