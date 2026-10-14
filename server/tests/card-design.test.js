import assert from 'node:assert/strict';
import test from 'node:test';
import { BACKGROUNDS } from '../../shared/designOptions.js';
import { THEMES } from '../../shared/cardOptions.js';
import { contrastRatio, minimumContrast, resolveCardDesign } from '../../shared/cardDesign.js';

const card = { theme: 'birthday', font: 'theme', fontSize: 'medium', textColor: null };

test('contrast uses relative luminance and handles invalid color input safely', () => {
  assert.equal(contrastRatio('#000000', '#ffffff'), 21);
  assert.equal(contrastRatio('#123456', '#123456'), 1);
  assert.equal(contrastRatio('#ffffff', '#000000'), 21);
  assert.equal(contrastRatio('url(secret)', '#ffffff'), 0);
});

test('every curated background keeps message contrast across all themes and selected inks', () => {
  for (const background of BACKGROUNDS.filter((option) => option.ink)) {
    for (const theme of THEMES) {
      for (const textColor of [null, '#ffffff', '#000000', '#777777', '#ff88aa', background.colors[0]]) {
        const rendered = resolveCardDesign({ ...card, theme: theme.id, textColor, design: { background: background.id } });
        assert.ok(minimumContrast(rendered.textColor, background.colors) >= 4.5, `${background.id}/${theme.id}/${textColor}`);
      }
    }
  }
});

test('legacy explicit ink is preserved with a contrasting reading surface when needed', () => {
  for (const [theme, textColor] of [['dark', '#123456'], ['birthday', '#ffffff'], ['celebration', '#965ecb']]) {
    const rendered = resolveCardDesign({ ...card, theme, textColor });
    assert.equal(rendered.textColor, textColor);
    assert.ok(rendered.readabilitySurface);
    assert.ok(contrastRatio(textColor, rendered.readabilitySurface) >= 4.5);
  }
  const defaultCard = resolveCardDesign(card);
  assert.equal(defaultCard.textColor, '#173f8b');
  assert.equal(defaultCard.readabilitySurface, null);
  assert.equal(defaultCard.background, null);
});

test('photo-based card layouts fall back without photos and preserve chosen photo arrangement', () => {
  for (const layout of ['photo', 'collage']) {
    const source = { ...card, design: { layout, photoLayout: 'stacked' } };
    assert.equal(resolveCardDesign(source, 0).effectiveLayout, 'centered');
    assert.equal(resolveCardDesign(source, 1).effectiveLayout, layout);
    assert.equal(resolveCardDesign(source, 4).photoLayout, 'stacked');
    assert.deepEqual(source.design, { layout, photoLayout: 'stacked' });
  }
});

test('damaged visual settings cannot become CSS and fall back to readable bounded values', () => {
  const rendered = resolveCardDesign({ theme: 'missing', font: 'url(secret)', fontSize: 300, textColor: '<style>',
    design: { background: 'url(secret)', layout: '<html>', textWeight: 1, lineSpacing: -100, css: 'position:fixed' } });
  assert.equal(rendered.background, null);
  assert.equal(rendered.effectiveLayout, 'centered');
  assert.equal(rendered.fontSize, 20);
  assert.equal(rendered.textWeight, 400);
  assert.equal(rendered.lineHeight, 1.7);
  assert.equal(rendered.textColor, '#173f8b');
  assert.ok(!JSON.stringify(rendered).includes('url(secret)'));
});
