import { ChatPalette } from './chat-palette';
import { SyncObject, SyncVar } from './core/synchronize-object/decorator';
import { DataElement } from './data-element';
import { TabletopObject } from './tabletop-object';

@SyncObject('character')
export class GameCharacter extends TabletopObject {
  private static readonly exportedStateAttribute = 'daphneCharacterState';

  @SyncVar() rotate: number = 0;
  @SyncVar() roll: number = 0;

  get name(): string { return this.getCommonValue('name', ''); }
  get size(): number { return this.getCommonValue('size', 1); }
  get createdByUserId(): string { return this.getAttribute('createdByUserId'); }
  get isGMCreated(): boolean { return this.getAttribute('gmCreated') === 'true'; }
  get isStatusHidden(): boolean { return this.getAttribute('statusHidden') === 'true'; }
  set isStatusHidden(isStatusHidden: boolean) {
    if (isStatusHidden) {
      this.setAttribute('statusHidden', 'true');
    } else {
      this.removeAttribute('statusHidden');
    }
  }

  markAsCreatedBy(userId: string, isGM: boolean) {
    this.setAttribute('createdByUserId', userId);
    if (isGM) {
      this.setAttribute('gmCreated', 'true');
    } else {
      this.removeAttribute('gmCreated');
    }
  }

  toXmlWithDaphneState(state: unknown): string {
    let hadState = this.getAttribute(GameCharacter.exportedStateAttribute).length > 0;
    let previousState = this.getAttribute(GameCharacter.exportedStateAttribute);
    this.attributes[GameCharacter.exportedStateAttribute] = JSON.stringify(state ?? {});
    let xml = this.toXml();
    if (hadState) {
      this.attributes[GameCharacter.exportedStateAttribute] = previousState;
    } else {
      delete this.attributes[GameCharacter.exportedStateAttribute];
    }
    return xml;
  }

  takeExportedDaphneState<T>(): T | null {
    let raw = this.getAttribute(GameCharacter.exportedStateAttribute);
    if (!raw) return null;
    this.removeAttribute(GameCharacter.exportedStateAttribute);
    try {
      return JSON.parse(raw) as T;
    } catch (_error) {
      return null;
    }
  }

  get chatPalette(): ChatPalette {
    for (let child of this.children) {
      if (child instanceof ChatPalette) return child;
    }
    return null;
  }

  static create(name: string, size: number, imageIdentifier: string): GameCharacter {
    let gameCharacter: GameCharacter = new GameCharacter();
    gameCharacter.createDataElements();
    gameCharacter.initialize();
    gameCharacter.createTestGameDataElement(name, size, imageIdentifier);

    return gameCharacter;
  }

  createTestGameDataElement(name: string, size: number, imageIdentifier: string) {
    this.createDataElements();

    let nameElement: DataElement = DataElement.create('name', name, {}, 'name_' + this.identifier);
    let sizeElement: DataElement = DataElement.create('size', size, {}, 'size_' + this.identifier);

    if (this.imageDataElement.getFirstElementByName('imageIdentifier')) {
      this.imageDataElement.getFirstElementByName('imageIdentifier').value = imageIdentifier;
    }

    let resourceElement: DataElement = DataElement.create('リソース', '', {}, 'リソース' + this.identifier);
    let hpElement: DataElement = DataElement.create('HP', 200, { 'type': 'numberResource', 'currentValue': '200' }, 'HP_' + this.identifier);
    let mpElement: DataElement = DataElement.create('MP', 100, { 'type': 'numberResource', 'currentValue': '100' }, 'MP_' + this.identifier);

    this.commonDataElement.appendChild(nameElement);
    this.commonDataElement.appendChild(sizeElement);

    this.detailDataElement.appendChild(resourceElement);
    resourceElement.appendChild(hpElement);
    resourceElement.appendChild(mpElement);

    //TEST
    let testElement: DataElement = DataElement.create('情報', '', {}, '情報' + this.identifier);
    this.detailDataElement.appendChild(testElement);
    testElement.appendChild(DataElement.create('説明', 'ここに説明を書く\nあいうえお', { 'type': 'note' }, '説明' + this.identifier));
    testElement.appendChild(DataElement.create('メモ', '任意の文字列\n１\n２\n３\n４\n５', { 'type': 'note' }, 'メモ' + this.identifier));

    //TEST
    testElement = DataElement.create('能力', '', {}, '能力' + this.identifier);
    this.detailDataElement.appendChild(testElement);
    testElement.appendChild(DataElement.create('器用度', 24, {}, '器用度' + this.identifier));
    testElement.appendChild(DataElement.create('敏捷度', 24, {}, '敏捷度' + this.identifier));
    testElement.appendChild(DataElement.create('筋力', 24, {}, '筋力' + this.identifier));
    testElement.appendChild(DataElement.create('生命力', 24, {}, '生命力' + this.identifier));
    testElement.appendChild(DataElement.create('知力', 24, {}, '知力' + this.identifier));
    testElement.appendChild(DataElement.create('精神力', 24, {}, '精神力' + this.identifier));

    //TEST
    testElement = DataElement.create('戦闘特技', '', {}, '戦闘特技' + this.identifier);
    this.detailDataElement.appendChild(testElement);
    testElement.appendChild(DataElement.create('Lv1', '全力攻撃', {}, 'Lv1' + this.identifier));
    testElement.appendChild(DataElement.create('Lv3', '武器習熟/ソード', {}, 'Lv3' + this.identifier));
    testElement.appendChild(DataElement.create('Lv5', '武器習熟/ソードⅡ', {}, 'Lv5' + this.identifier));
    testElement.appendChild(DataElement.create('Lv7', '頑強', {}, 'Lv7' + this.identifier));
    testElement.appendChild(DataElement.create('Lv9', '薙ぎ払い', {}, 'Lv9' + this.identifier));
    testElement.appendChild(DataElement.create('自動', '治癒適正', {}, '自動' + this.identifier));

    let domParser: DOMParser = new DOMParser();
    let gameCharacterXMLDocument: Document = domParser.parseFromString(this.rootDataElement.toXml(), 'application/xml');

    let palette: ChatPalette = new ChatPalette('ChatPalette_' + this.identifier);
    palette.setPalette(`チャットパレット入力例：
2d6+1 ダイスロール
１ｄ２０＋{敏捷}＋｛格闘｝　{name}の格闘！
//敏捷=10+{敏捷A}
//敏捷A=10
//格闘＝１`);
    palette.initialize();
    this.appendChild(palette);
  }
}
