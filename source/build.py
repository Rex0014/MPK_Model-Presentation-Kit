#!/usr/bin/env python3
"""Assemble the single-file editor (dist/Main.html) from src/ and vendor/."""
import base64, json, pathlib, re, subprocess, sys

ROOT = pathlib.Path(__file__).parent
SRC, VEN, DIST = ROOT / 'src', ROOT / 'vendor', ROOT / 'dist'
DIST.mkdir(exist_ok=True)

def read(p): return (p).read_text(encoding='utf-8')

def safe_script(js, name):
    if re.search(r'</script|<!--', js, re.I):
        js = re.sub(r'</script', r'<\\/script', js, flags=re.I).replace('<!--', '<\\!--')
        print('  escaped script terminators in', name)
    return js

def fonts_inline(css):
    def rep(m):
        f = VEN / 'fonts' / m.group(1)
        return 'url("data:font/ttf;base64,' + base64.b64encode(f.read_bytes()).decode() + '")'
    return re.sub(r'url\("fonts/([^"]+)"\)', rep, css)

rt_css = fonts_inline(read(VEN / 'industry.css')) + '\n' + read(SRC / 'deck.css')
three = safe_script(read(VEN / 'three.bundle.js'), 'three')
draco = safe_script(read(VEN / 'draco-decoder-src.js'), 'draco')
engine = safe_script(read(SRC / 'engine.js'), 'engine')
player = safe_script(read(SRC / 'player.js'), 'player')
hud = read(SRC / 'player.html')

# --- Main.html (editor) ---
if (SRC / 'main.html').exists():
  tpl = read(SRC / 'main.html')
  parts = {
      'RT_CSS': rt_css, 'RT_HUD': hud, 'RT_THREE': three, 'RT_DRACO': draco, 'RT_ENGINE': engine, 'RT_PLAYER': player,
      'ED_CSS': read(SRC / 'editor.css'), 'ED_SAMPLES': safe_script(read(SRC / 'samples.js'), 'samples'),
      'ED_MAIN': safe_script(read(SRC / 'editor.js'), 'editor'),
  }
  out = tpl
  for k, v in parts.items():
      token = '/*@' + k + '@*/'
      assert token in out, token
      out = out.replace(token, v)
  (DIST / 'Main.html').write_text(out, encoding='utf-8')
  print('dist/Main.html', round(len(out.encode()) / 1e6, 2), 'MB')

# --- shipped example deck: demo-actuator.js + assets/actuator.glb, exported the way the editor does it ---
def deck_html(deck_js, title, assets=()):
    deck = subprocess.check_output(['node', '-e',
        'global.window={};require(process.argv[1]);process.stdout.write(JSON.stringify(window.DEMO_DECK))',
        str(deck_js)]).decode()
    data = json.dumps(json.loads(deck), ensure_ascii=False).replace('<', '\\u003c')
    tags = ''.join('<script type="application/octet-stream" data-asset="%s" data-name="%s" data-mime="%s">%s</script>\n'
                   % (i, f.name, m, base64.b64encode(f.read_bytes()).decode()) for i, f, m in assets)
    return ('<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n'
            '<meta name="generator" content="Deck Builder">\n<title>' + title + '</title>\n<style>' + rt_css + '</style>\n</head>\n<body>\n' + hud +
            '\n<script>' + three + '</script>\n<script>' + draco + '</script>\n'
            '<script type="application/json" id="deck-data">' + data + '</script>\n' + tags +
            '<script>' + engine + '</script>\n<script>' + player + '</script>\n</body>\n</html>\n')

if '--demo' in sys.argv:
    html = deck_html(ROOT / 'demo-actuator.js', 'Telescopic Linear Actuator',
                     [('actuator', ROOT / 'assets' / 'actuator.glb', 'model/gltf-binary')])
    (ROOT.parent / 'Demo - Telescopic Linear Actuator.html').write_text(html, encoding='utf-8')
    print('Demo - Telescopic Linear Actuator.html', round(len(html.encode()) / 1e6, 2), 'MB')
