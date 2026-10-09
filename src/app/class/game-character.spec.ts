import { ObjectSerializer } from './core/synchronize-object/object-serializer';
import { GameCharacter } from './game-character';

describe('GameCharacter image scale', () => {
  it('keeps the pedestal size when changing and cloning the image scale', () => {
    let character = GameCharacter.create('test', 2, '');
    try {
      expect(character.imageScale).toBe(1);
      character.ensureImageScaleElement().value = 2.5;
      expect(character.imageScale).toBe(2.5);
      expect(character.size).toBe(2);
      let clone = character.clone();
      expect(clone.imageScale).toBe(2.5);
      expect(clone.size).toBe(2);
      clone.destroy();
    } finally { character.destroy(); }
  });

  it('adds the slider parameter once after size for legacy XML', () => {
    let character = GameCharacter.create('test', 2, '');
    let xml = new DOMParser().parseFromString(character.toXml(), 'application/xml');
    xml.querySelector('data[name="imageScale"]').remove();
    let legacy = ObjectSerializer.instance.parseXml(xml.documentElement) as GameCharacter;
    try {
      expect(legacy.imageScale).toBe(1);
      let element = legacy.ensureImageScaleElement();
      expect(legacy.ensureImageScaleElement()).toBe(element);
      expect(legacy.commonDataElement.children.map(child => child.getAttribute('name')))
        .toEqual(['name', 'size', 'imageScale']);
      expect(element.value).toBe(1);
    } finally { legacy.destroy(); character.destroy(); }
  });

  it('uses a visible safe scale for malformed imported values', () => {
    let character = GameCharacter.create('test', 1, '');
    try {
      for (let value of ['', 'invalid', 0, -2, Infinity]) {
        character.ensureImageScaleElement().value = value;
        expect(character.imageScale).toBe(1);
      }
      character.ensureImageScaleElement().value = 20;
      expect(character.imageScale).toBe(5);
    } finally { character.destroy(); }
  });
});
