/**
 * Handverlesene Smiley-Auswahl fuer den Chat (Konzept chat-reaktionen).
 *
 * Bewusst KEINE Emoji-Bibliothek: die ueblichen Pakete bringen alle ~3.700
 * Zeichen samt Daten mit (mehrere hundert kB) und laden teils Bilder von
 * fremden Servern -- bei einer Anwendung mit Klientendaten keine Option
 * (gleiches Argument wie bei den Schriften, siehe styles/schrift.css).
 * Dargestellt wird mit der Emoji-Schrift des Geraets.
 *
 * Suchwoerter sind deutsch und klein geschrieben; das erste ist zugleich die
 * Beschriftung fuer Screenreader. Jedes Zeichen ist eine vollstaendige
 * RGI-Sequenz (mit U+FE0F, wo noetig) -- dieselbe Pruefung macht die API
 * (chat.schemas.ts), sonst schluege eine Reaktion mit 400 fehl.
 */
export interface SmileyGruppe {
  name: string;
  /** Zeichen fuer den Reiter der Gruppe. */
  symbol: string;
  eintraege: readonly (readonly [zeichen: string, suchwoerter: string])[];
}

export const SMILEY_GRUPPEN: readonly SmileyGruppe[] = [
  {
    name: "Smileys & Gefühle",
    symbol: "😊",
    eintraege: [
      ["😀", "grinsen lachen froh"],
      ["😃", "lachen froh freude"],
      ["😄", "lachen freude augen"],
      ["😁", "strahlen grinsen zähne"],
      ["😆", "lachen laut"],
      ["😅", "erleichtert schwitzen puh"],
      ["😂", "tränen lachen lustig"],
      ["🙂", "lächeln leicht freundlich"],
      ["😉", "zwinkern"],
      ["😊", "lächeln freundlich rot"],
      ["😇", "heilig engel unschuldig"],
      ["🥰", "verliebt herzen lieb"],
      ["😍", "verliebt herzaugen"],
      ["😘", "kuss"],
      ["😋", "lecker essen"],
      ["😎", "cool sonnenbrille"],
      ["🤗", "umarmen drücken"],
      ["🤔", "nachdenken überlegen hmm"],
      ["🤨", "skeptisch zweifel"],
      ["😐", "neutral egal"],
      ["😶", "sprachlos still"],
      ["🙄", "augenrollen genervt"],
      ["😏", "grinsen schief"],
      ["😌", "erleichtert zufrieden ruhig"],
      ["😴", "schlafen müde"],
      ["🥱", "gähnen müde"],
      ["😮", "staunen überrascht oh"],
      ["😲", "erstaunt schock"],
      ["😳", "verlegen rot peinlich"],
      ["🥺", "bitte flehen"],
      ["😢", "traurig weinen träne"],
      ["😭", "weinen heulen"],
      ["😤", "schnauben trotz"],
      ["😠", "wütend ärger"],
      ["😬", "grimasse peinlich oje"],
      ["😓", "schweiß stress"],
      ["🤒", "krank fieber"],
      ["🤧", "niesen erkältet schnupfen"],
      ["😷", "maske krank"],
      ["🥳", "party feiern geburtstag"],
      ["🤩", "begeistert sterne"],
      ["🫡", "salut jawohl"],
    ],
  },
  {
    name: "Gesten & Menschen",
    symbol: "👋",
    eintraege: [
      ["👋", "winken hallo tschüss"],
      ["👍", "daumen hoch gut ok ja"],
      ["👎", "daumen runter schlecht nein"],
      ["👌", "ok perfekt"],
      ["✌️", "peace sieg zwei"],
      ["🤞", "daumen drücken glück"],
      ["🤙", "anrufen melden"],
      ["👏", "klatschen applaus bravo"],
      ["🙌", "hurra jubel"],
      ["🙏", "danke bitte beten"],
      ["🤝", "handschlag abgemacht"],
      ["💪", "stark kraft muskel"],
      ["✍️", "schreiben notieren"],
      ["👀", "augen schauen gucken"],
      ["👂", "ohr hören zuhören"],
      ["🧠", "gehirn denken"],
      ["🙋", "melden hand hoch ich"],
      ["🤷", "schulterzucken keine ahnung"],
      ["🤦", "facepalm oh nein"],
      ["🙆", "okay gut"],
      ["🙅", "nein stopp"],
      ["👶", "baby kind"],
      ["🧑", "person mensch"],
      ["👪", "familie eltern"],
      ["🧑‍⚕️", "arzt ärztin pflege"],
      ["🧑‍🍳", "kochen koch"],
      ["🏃", "rennen laufen eilig"],
      ["🚶", "gehen spazieren"],
    ],
  },
  {
    name: "Herzen & Zeichen",
    symbol: "❤️",
    eintraege: [
      ["❤️", "herz liebe rot"],
      ["🧡", "herz orange"],
      ["💛", "herz gelb"],
      ["💚", "herz grün"],
      ["💙", "herz blau"],
      ["💜", "herz lila"],
      ["🤍", "herz weiß"],
      ["💔", "herz gebrochen"],
      ["💕", "herzen zwei liebe"],
      ["✨", "funkeln glitzer"],
      ["⭐", "stern"],
      ["🌟", "stern leuchtend"],
      ["🔥", "feuer heiß super"],
      ["💯", "hundert perfekt"],
      ["✅", "erledigt fertig haken ok"],
      ["☑️", "abgehakt kästchen"],
      ["✔️", "haken richtig"],
      ["❌", "kreuz falsch nein"],
      ["❗", "ausrufezeichen wichtig achtung"],
      ["❓", "fragezeichen frage"],
      ["⚠️", "warnung achtung vorsicht"],
      ["🚫", "verboten nein"],
      ["⏰", "wecker zeit pünktlich"],
      ["⏳", "warten sanduhr gleich"],
      ["📌", "pin merken wichtig"],
      ["💡", "idee glühbirne"],
      ["🔔", "glocke erinnerung"],
      ["💤", "schlafen zzz"],
      ["➕", "plus dazu"],
      ["➡️", "pfeil rechts weiter"],
    ],
  },
  {
    name: "Tiere & Natur",
    symbol: "🐱",
    eintraege: [
      ["🐱", "katze"],
      ["🐈", "katze laufen"],
      ["🐶", "hund"],
      ["🐕", "hund laufen"],
      ["🐰", "hase kaninchen"],
      ["🐻", "bär"],
      ["🐼", "panda"],
      ["🦊", "fuchs"],
      ["🐦", "vogel"],
      ["🐟", "fisch"],
      ["🐢", "schildkröte langsam"],
      ["🦋", "schmetterling"],
      ["🐝", "biene"],
      ["🌸", "blüte blume"],
      ["🌻", "sonnenblume"],
      ["🌷", "tulpe blume"],
      ["🌱", "pflanze keimling"],
      ["🌳", "baum"],
      ["🍀", "kleeblatt glück"],
      ["🍂", "herbst blätter"],
      ["☀️", "sonne sonnig"],
      ["⛅", "wolken sonne"],
      ["🌧️", "regen"],
      ["⛈️", "gewitter"],
      ["❄️", "schnee kalt"],
      ["⛄", "schneemann winter"],
      ["🌈", "regenbogen"],
      ["🌙", "mond nacht"],
    ],
  },
  {
    name: "Essen & Trinken",
    symbol: "☕",
    eintraege: [
      ["☕", "kaffee tee pause"],
      ["🍵", "tee"],
      ["🥤", "getränk becher"],
      ["💧", "wasser tropfen"],
      ["🍎", "apfel obst"],
      ["🍌", "banane obst"],
      ["🍓", "erdbeere"],
      ["🥕", "karotte möhre gemüse"],
      ["🥦", "brokkoli gemüse"],
      ["🍞", "brot"],
      ["🥨", "brezel"],
      ["🥐", "croissant frühstück"],
      ["🧀", "käse"],
      ["🥚", "ei"],
      ["🍳", "spiegelei kochen braten"],
      ["🍕", "pizza"],
      ["🍝", "nudeln spaghetti"],
      ["🍲", "eintopf suppe"],
      ["🥗", "salat"],
      ["🍔", "burger"],
      ["🍟", "pommes"],
      ["🍰", "kuchen torte"],
      ["🎂", "geburtstagskuchen torte"],
      ["🍪", "keks plätzchen"],
      ["🍫", "schokolade"],
      ["🍦", "eis"],
      ["🍽️", "essen teller mittag"],
      ["🛒", "einkaufen einkauf"],
    ],
  },
  {
    name: "Unterwegs & Orte",
    symbol: "🚌",
    eintraege: [
      ["🚌", "bus"],
      ["🚆", "zug bahn"],
      ["🚇", "u-bahn"],
      ["🚊", "straßenbahn tram"],
      ["🚗", "auto"],
      ["🚕", "taxi"],
      ["🚲", "fahrrad rad"],
      ["🛴", "roller"],
      ["🚑", "krankenwagen notfall"],
      ["🚓", "polizei"],
      ["✈️", "flugzeug urlaub"],
      ["🏠", "haus zuhause"],
      ["🏡", "haus garten"],
      ["🏢", "büro gebäude"],
      ["🏥", "krankenhaus klinik"],
      ["🏫", "schule"],
      ["🏦", "bank"],
      ["⛪", "kirche"],
      ["🏖️", "strand urlaub"],
      ["⛰️", "berg"],
      ["🗺️", "karte weg"],
      ["📍", "ort standort hier"],
    ],
  },
  {
    name: "Freizeit & Feiern",
    symbol: "⚽",
    eintraege: [
      ["🎉", "party feiern konfetti glückwunsch"],
      ["🎊", "konfetti feiern"],
      ["🎈", "luftballon"],
      ["🎁", "geschenk"],
      ["🎂", "geburtstag torte"],
      ["🎄", "weihnachten baum"],
      ["🎃", "halloween kürbis"],
      ["🥚", "ostern ei"],
      ["⚽", "fußball sport"],
      ["🏀", "basketball"],
      ["🏊", "schwimmen"],
      ["🚴", "radfahren"],
      ["🧘", "yoga entspannen"],
      ["🎮", "spielen konsole"],
      ["🎲", "würfel spiel"],
      ["🧩", "puzzle"],
      ["🎨", "malen kunst"],
      ["🎵", "musik note"],
      ["🎤", "singen mikrofon"],
      ["🎬", "film kino"],
      ["📺", "fernsehen tv"],
      ["📚", "bücher lesen"],
      ["🏆", "pokal gewonnen sieger"],
      ["🥇", "medaille erster gold"],
    ],
  },
  {
    name: "Gegenstände",
    symbol: "📅",
    eintraege: [
      ["📅", "kalender termin datum"],
      ["📞", "telefon anrufen"],
      ["📱", "handy smartphone"],
      ["💻", "laptop computer"],
      ["✉️", "brief post"],
      ["📧", "mail e-mail"],
      ["📝", "notiz schreiben"],
      ["📄", "dokument blatt"],
      ["📎", "büroklammer anhang"],
      ["✏️", "stift bleistift"],
      ["🔑", "schlüssel"],
      ["🔒", "schloss abgeschlossen"],
      ["💶", "geld euro"],
      ["💳", "karte bezahlen"],
      ["💊", "tablette medikament"],
      ["🩹", "pflaster"],
      ["🩺", "stethoskop arzt"],
      ["🧺", "wäsche korb"],
      ["🧹", "besen putzen"],
      ["🧽", "schwamm putzen"],
      ["🛏️", "bett schlafen"],
      ["🚿", "dusche"],
      ["🔧", "werkzeug reparieren"],
      ["🔦", "taschenlampe"],
      ["☂️", "regenschirm"],
      ["🎒", "rucksack schule"],
    ],
  },
];

/** Alle Zeichen genau einmal (z. B. 🎂 und 🥚 stehen in zwei Gruppen). */
export const ALLE_SMILEYS: readonly (readonly [string, string])[] = (() => {
  const gesehen = new Set<string>();
  const alle: (readonly [string, string])[] = [];
  for (const g of SMILEY_GRUPPEN) {
    for (const e of g.eintraege) {
      if (gesehen.has(e[0])) continue;
      gesehen.add(e[0]);
      alle.push(e);
    }
  }
  return alle;
})();

function normalisiere(s: string): string {
  return s.toLocaleLowerCase("de").replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss").trim();
}

/** Wortanfang zaehlt vor Treffer mitten im Wort: "herz" soll ❤️ vor "schmerz"-Treffern liefern. */
export function sucheSmileys(anfrage: string): string[] {
  const q = normalisiere(anfrage);
  if (!q) return [];
  const vorn: string[] = [];
  const innen: string[] = [];
  for (const [zeichen, woerter] of ALLE_SMILEYS) {
    const w = normalisiere(woerter).split(/\s+/);
    if (w.some((x) => x.startsWith(q))) vorn.push(zeichen);
    else if (w.some((x) => x.includes(q))) innen.push(zeichen);
  }
  return [...vorn, ...innen];
}

/** Erstes Suchwort als Beschriftung fuer Screenreader und Tooltip. */
export function smileyName(zeichen: string): string {
  return ALLE_SMILEYS.find((e) => e[0] === zeichen)?.[1].split(" ")[0] ?? zeichen;
}
