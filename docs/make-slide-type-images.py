#!/usr/bin/env python3
"""Wireframe thumbnail (SVG + PNG) for every slide type in engine.js TYPES.

    python3 docs/make-slide-type-images.py
"""
import os, subprocess

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'slide-types')
BG, DARK, SURF, TEXT, MUTE, ACC = '#E8E8E9', '#191921', '#D1D1D3', '#303037', '#A3A3A6', '#141561'
P = 28  # slide padding, design px

# name: (w, h, label)
TYPES = {
    'title': (860, 500, 'Title'), 'section': (760, 440, 'Section'),
    'card': (640, 440, 'Card'), 'split': (920, 480, 'Two columns'),
    'callout': (600, 300, 'Callout'), 'labels': (380, 150, 'Part labels'),
    'metrics': (860, 420, 'Key figures'), 'table': (820, 480, 'Table'),
    'compare': (920, 480, 'Compare'), 'checklist': (660, 460, 'Checklist'),
    'code': (760, 480, 'Code'), 'image': (820, 560, 'Image'),
    'timeline': (1100, 300, 'Timeline'), 'caption': (900, 140, 'Model view'),
    'end': (760, 440, 'End'),
}

def bar(x, y, w, h, fill=TEXT, r=2, o=1.0):
    return f'<rect x="{x:.0f}" y="{y:.0f}" width="{w:.0f}" height="{h:.0f}" rx="{r}" fill="{fill}" opacity="{o}"/>'

def box(x, y, w, h, fill='none', stroke=MUTE, dash=''):
    d = f' stroke-dasharray="{dash}"' if dash else ''
    return f'<rect x="{x:.0f}" y="{y:.0f}" width="{w:.0f}" height="{h:.0f}" fill="{fill}" stroke="{stroke}"{d}/>'

def lines(x, y, w, n, gap=16, h=7, o=0.45, last=0.6):
    return ''.join(bar(x, y + i * gap, w * (last if i == n - 1 else 1), h, TEXT, 2, o) for i in range(n))

def kicker(x, y, ink=ACC):
    return bar(x, y, 110, 8, ink, 2, .8)

def corners(w, h, ink=MUTE):
    k, o = 14, 10
    g = []
    for cx, cy, sx, sy in ((o, o, 1, 1), (w - o, o, -1, 1), (o, h - o, 1, -1), (w - o, h - o, -1, -1)):
        g.append(f'<path d="M{cx} {cy + sy * k}V{cy}H{cx + sx * k}" fill="none" stroke="{ink}" stroke-width="1.5"/>')
    return ''.join(g)

def xmark(x, y, ink=ACC):  # pin crosshair
    return (f'<circle cx="{x}" cy="{y}" r="5" fill="none" stroke="{ink}" stroke-width="1.5"/>'
            f'<path d="M{x-12} {y}h24M{x} {y-12}v24" stroke="{ink}" stroke-width="1"/>')

def cols(x, w, n, gap=18):
    cw = (w - gap * (n - 1)) / n
    return [(x + i * (cw + gap), cw) for i in range(n)]


def draw(name, w, h):
    g, W = [], w - 2 * P
    if name == 'title':
        g += [kicker(P, P), bar(P, P + 36, W * .8, 34), bar(P, P + 80, W * .5, 34), lines(P, P + 142, W * .62, 2)]
        for x, cw in cols(P, W, 4):
            g += [bar(x, h - P - 54, cw * .55, 7, TEXT, 2, .45), bar(x, h - P - 36, cw * .8, 20, ACC, 2, .85)]
    elif name in ('section', 'end'):
        g += [f'<rect width="{w}" height="{h}" fill="{DARK}"/>', corners(w, h, '#6b6b78')]
        if name == 'section':
            g += [kicker(P, P, '#8e8fd0'), bar(P, h / 2 - 80, 120, 64, '#FFFFFF', 3, .9),
                  bar(P, h / 2 + 10, W * .62, 26, '#FFFFFF', 2, .85), lines(P, h / 2 + 60, W * .55, 2, 16, 7, .5, .6)]
        else:
            g += [kicker(P, P, '#8e8fd0'), bar(P, h / 2 - 40, W * .55, 34, '#FFFFFF', 3, .9),
                  lines(P, h / 2 + 20, W * .45, 2, 16, 7, .5, .6)]
    elif name == 'card':
        g += [kicker(P, P), bar(P, P + 30, W * .7, 24), lines(P, P + 76, W, 3)]
        g += [box(P, P + 140, W, 110, SURF, MUTE), f'<path d="M{P} {P+250}L{P+W*.45:.0f} {P+160}L{P+W:.0f} {P+250}" fill="none" stroke="{MUTE}"/>']
        for i in range(3):
            y = P + 272 + i * 24
            g += [bar(P, y, W * .45, 7, TEXT, 2, .45), bar(P + W * .6, y, W * .4, 7, TEXT, 2, .7),
                  f'<line x1="{P}" y1="{y+16}" x2="{P+W}" y2="{y+16}" stroke="{MUTE}" opacity=".6"/>']
    elif name == 'split':
        g += [kicker(P, P), bar(P, P + 30, W * .6, 24)]
        (lx, cw), (rx, _) = cols(P, W, 2, 36)
        g += [lines(lx, P + 86, cw, 7), box(rx, P + 86, cw, 120, SURF, MUTE),
              f'<path d="M{rx} {P+206}L{rx+cw*.45:.0f} {P+120}L{rx+cw:.0f} {P+206}" fill="none" stroke="{MUTE}"/>']
        for i in range(4):
            y = P + 228 + i * 24
            g += [bar(rx, y, cw * .45, 7, TEXT, 2, .45), bar(rx + cw * .6, y, cw * .4, 7, TEXT, 2, .7),
                  f'<line x1="{rx}" y1="{y+16}" x2="{rx+cw}" y2="{y+16}" stroke="{MUTE}" opacity=".6"/>']
    elif name == 'callout':
        bx, by, bh = 150, 20, 160
        g += [f'<polyline points="16,{h-16} {bx-40},{by+bh} {bx},{by+bh}" fill="none" stroke="{ACC}" stroke-width="1.5"/>',
              xmark(16, h - 16), box(bx, by, w - bx - 10, bh, '#FFFFFF', MUTE)]
        g += [kicker(bx + 20, by + 20), bar(bx + 20, by + 44, (w - bx - 50) * .7, 18),
              lines(bx + 20, by + 78, w - bx - 50, 3, 15, 6)]
    elif name == 'labels':
        for i, (ty, tw) in enumerate(((12, 150), (60, 180), (108, 130))):
            g += [box(60, ty, tw, 30, '#FFFFFF', MUTE), bar(72, ty + 11, tw - 40, 8, ACC, 2, .8),
                  f'<line x1="18" y1="{ty+15}" x2="60" y2="{ty+15}" stroke="{ACC}"/>', f'<circle cx="14" cy="{ty+15}" r="4" fill="{ACC}"/>']
    elif name == 'metrics':
        g += [kicker(P, P), bar(P, P + 30, W * .55, 24), lines(P, P + 76, W * .7, 1)]
        for x, cw in cols(P, W, 4):
            g += [box(x, P + 120, cw, 140, SURF, MUTE), bar(x + 14, P + 140, cw * .6, 7, TEXT, 2, .5),
                  bar(x + 14, P + 164, cw * .72, 32, ACC, 3, .9), bar(x + 14, P + 212, cw * .5, 7, TEXT, 2, .35)]
    elif name == 'table':
        g += [kicker(P, P), bar(P, P + 30, W * .5, 24)]
        ty, cw = P + 92, W / 4
        g += [f'<line x1="{P}" y1="{ty+24}" x2="{P+W}" y2="{ty+24}" stroke="{TEXT}" stroke-width="1.5"/>']
        for j in range(4):
            g.append(bar(P + j * cw + 6, ty + 6, cw * .55, 8, TEXT, 2, .8))
        for i in range(6):
            y = ty + 44 + i * 30
            for j in range(4):
                g.append(bar(P + j * cw + 6, y, cw * (.7 if j == 0 else .45), 7, TEXT, 2, .45))
            g.append(f'<line x1="{P}" y1="{y+18}" x2="{P+W}" y2="{y+18}" stroke="{MUTE}" opacity=".5"/>')
    elif name == 'compare':
        g += [kicker(P, P), bar(P, P + 30, W * .5, 24)]
        for x, cw in cols(P, W, 3, 24):
            g += [box(x, P + 92, cw, h - P - 120, SURF, MUTE), bar(x + 14, P + 110, cw * .6, 16, ACC, 2, .9),
                  f'<line x1="{x+14}" y1="{P+140}" x2="{x+cw-14}" y2="{P+140}" stroke="{MUTE}"/>',
                  lines(x + 14, P + 156, cw - 28, 6, 22)]
    elif name == 'checklist':
        g += [kicker(P, P), bar(P, P + 30, W * .55, 24)]
        for i in range(5):
            y = P + 92 + i * 60
            g += [box(P, y, 26, 26, '#FFFFFF', ACC if i < 3 else MUTE)]
            if i < 2:
                g.append(f'<path d="M{P+7} {y+13}l5 6 8-10" fill="none" stroke="{ACC}" stroke-width="2"/>')
            g += [
                  bar(P + 40, y + 2, W * .55, 9, TEXT, 2, .7), bar(P + 40, y + 20, W * .4, 7, TEXT, 2, .35)]
            if i in (2, 3):
                g += [box(P + W - 70, y + 2, 70, 20, 'none', ACC), bar(P + W - 58, y + 9, 46, 6, ACC, 2, .8)]
    elif name == 'code':
        g += [kicker(P, P), bar(P, P + 30, W * .5, 24), box(P, P + 86, W, h - P - 150, DARK, DARK)]
        g += [box(P + W - 78, P + 98, 66, 20, 'none', '#8e8fd0'), bar(P + W - 68, P + 105, 46, 6, '#8e8fd0', 2, .9)]
        import random; random.seed(7)
        for i in range(9):
            y = P + 134 + i * 26
            g += [bar(P + 16, y, 12, 7, '#FFFFFF', 2, .25),
                  bar(P + 44 + (i % 3) * 18, y, (W - 90) * random.uniform(.3, .8), 7, '#FFFFFF', 2, .55)]
        g += [lines(P, h - P - 28, W * .6, 2, 16, 6)]
    elif name == 'image':
        g += [kicker(P, P), bar(P, P + 30, W * .5, 24), box(P, P + 86, W, h - P - 190, SURF, MUTE)]
        g += [f'<path d="M{P} {h-P-104}L{P+W*.38:.0f} {P+180}L{P+W*.62:.0f} {h-P-150}L{P+W*.8:.0f} {P+260}L{P+W} {h-P-104}" fill="none" stroke="{MUTE}"/>',
              f'<circle cx="{P+W*.78:.0f}" cy="{P+150}" r="22" fill="none" stroke="{MUTE}"/>', lines(P, h - P - 62, W * .7, 2, 16, 6)]
    elif name == 'timeline':
        g += [kicker(P, P), bar(P, P + 26, 300, 22)]
        y = h - 110
        g += [f'<line x1="{P}" y1="{y}" x2="{w-P}" y2="{y}" stroke="{MUTE}"/>']
        for i, (x, cw) in enumerate(cols(P, W, 5, 10)):
            fill = ACC if i < 2 else BG
            g += [bar(x, y - 34, cw * .4, 7, TEXT, 2, .45),
                  f'<circle cx="{x+6}" cy="{y}" r="7" fill="{fill}" stroke="{ACC}" stroke-width="1.5"/>',
                  bar(x, y + 20, cw * .7, 9, TEXT, 2, .8), bar(x, y + 38, cw * .55, 7, TEXT, 2, .35)]
    elif name == 'caption':
        g += [kicker(P, h / 2 - 22), bar(P, h / 2 - 2, W * .45, 22), bar(w - P - 70, h / 2 - 6, 70, 10, TEXT, 2, .45)]
    return ''.join(g)


def svg(name, w, h):
    dark = name in ('section', 'end')
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w}" height="{h}">'
            f'<rect width="{w}" height="{h}" fill="{BG}"/>'
            + ('' if name in ('callout', 'labels') else corners(w, h))
            + draw(name, w, h) + '</svg>')


os.makedirs(OUT, exist_ok=True)
for name, (w, h, label) in TYPES.items():
    p = os.path.join(OUT, name + '.svg')
    open(p, 'w').write(svg(name, w, h))
    subprocess.run(['rsvg-convert', '-w', '860', '-o', p[:-4] + '.png', p], check=True)
    print(label.ljust(12), p)
