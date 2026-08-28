/**
 * Ein Ort fuer Groesse, Strichstaerke und die Barrierefreiheits-
 * Voreinstellung aller Icons.
 *
 * WICHTIG FUER DIE BUNDLE-GROESSE: ausschliesslich NAMENTLICHE Importe aus
 * "lucide-react". Kein `import * as`, kein `lucide-react/dynamicIconImports`,
 * kein <DynamicIcon> -- jedes davon zieht das komplette Set (>1 MB) ins
 * Bundle, weil Rollup dann nichts mehr wegwerfen kann. So sind es rund
 * 5 kB gzip fuer ~45 Icons.
 *
 * Alle Icons hier sind DEKORATIV: sie stehen immer neben einem Text, der
 * dieselbe Information traegt. Deshalb aria-hidden als Voreinstellung --
 * ein Screenreader soll "Speichern" hoeren, nicht "Diskette Speichern".
 * Rein ikonische Knoepfe (Theme-Umschalter, KW-Pfeile, Passwort-Auge)
 * brauchen daher zwingend ein eigenes aria-label am <button>.
 */
import {
  ArrowLeft,
  Ban,
  Banknote,
  BookX,
  Building2,
  CalendarCheck,
  CalendarX2,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  CircleCheck,
  CircleSlash,
  CircleX,
  Clock,
  Copy,
  DoorClosed,
  DoorOpen,
  Eraser,
  Eye,
  EyeOff,
  FileClock,
  FileText,
  HandCoins,
  History,
  IdCard,
  Info,
  KeyRound,
  LayoutList,
  Link2,
  LogIn,
  LogOut,
  MapPin,
  MapPinOff,
  Maximize2,
  Minimize2,
  Monitor,
  Moon,
  NotebookPen,
  Palette,
  PanelLeftClose,
  PanelLeftOpen,
  PenLine,
  Pencil,
  Plus,
  Receipt,
  ReceiptText,
  RotateCcw,
  Save,
  Settings,
  ShieldCheck,
  ShieldOff,
  Sun,
  Tag,
  TriangleAlert,
  UserRound,
  UserRoundMinus,
  UserRoundPlus,
  UserRoundSearch,
  UserRoundX,
  Users,
  Wallet,
  X,
  type LucideProps,
} from "lucide-react";
import type { ComponentType } from "react";

/**
 * strokeWidth 1.75 statt der lucide-Voreinstellung 2: bei 16px wirken die
 * Icons damit weniger schwer neben Inter, ohne auszufransen. Der Wert
 * spiegelt --zv-icon-stroke aus tokens.css.
 */
const grund = {
  size: 16,
  strokeWidth: 1.75,
  "aria-hidden": true,
  focusable: "false",
} as const;

/**
 * Der oeffentliche Typ aller Icons hier. Bewusst ComponentType und nicht
 * "(p) => JSX.Element": lucide liefert ForwardRefExoticComponent, deren
 * Rueckgabetyp ReactNode ist -- eine engere Signatur waere schlicht falsch
 * und wuerde jeden Aufrufer zum Casten zwingen.
 */
export type IconKomponente = ComponentType<LucideProps>;

function baue(Komponente: IconKomponente): IconKomponente {
  return (p: LucideProps) => <Komponente {...grund} {...p} />;
}

/* Hauptnavigation */
export const IZimmer = baue(DoorOpen);
export const IKlienten = baue(Users);
export const IKassenbuch = baue(Wallet);
export const IMitarbeitende = baue(IdCard);
export const ITagesberichte = baue(NotebookPen);
export const IEinstellungen = baue(Settings);

/* Unterreiter */
export const IUebersicht = baue(LayoutList);
export const IKostenuebernahme = baue(FileClock);
export const IRechnung = baue(Receipt);
export const IDarstellung = baue(Palette);
export const ISicherheit = baue(ShieldCheck);

/* Aktionen */
export const IAnmelden = baue(LogIn);
export const IAbmelden = baue(LogOut);
export const INeu = baue(Plus);
export const IAbbrechen = baue(X);
export const ISpeichern = baue(Save);
export const IBestaetigen = baue(Check);
export const IBeenden = baue(CalendarCheck);
export const IStornieren = baue(Ban);
export const IGenehmigen = baue(CircleCheck);
export const IAblehnen = baue(CircleX);
export const IAuszahlen = baue(HandCoins);
export const IPasswort = baue(KeyRound);
export const IResetLink = baue(Link2);
export const IVergroessern = baue(Maximize2);
export const IVerkleinern = baue(Minimize2);
export const IDokument = baue(FileText);
export const IUnterschrift = baue(PenLine);
export const ILoeschen = baue(Eraser);
export const IVerlauf = baue(History);
export const IZurueck = baue(ArrowLeft);
export const IKopieren = baue(Copy);
export const IZuruecksetzen = baue(RotateCcw);
export const IBearbeiten = baue(Pencil);
export const IEinziehen = baue(UserRoundPlus);
export const IAuszug = baue(UserRoundMinus);
export const I2faEin = baue(ShieldCheck);
export const I2faAus = baue(ShieldOff);
export const IEinklappen = baue(PanelLeftClose);
export const IAusklappen = baue(PanelLeftOpen);

/* Richtungen */
export const IAufklappen = baue(ChevronDown);
export const IZuklappen = baue(ChevronUp);
export const IVor = baue(ChevronRight);
export const IZurueckPfeil = baue(ChevronLeft);

/* Theme */
export const IHell = baue(Sun);
export const IDunkel = baue(Moon);
export const ISystem = baue(Monitor);
export const ISichtbar = baue(Eye);
export const IVerborgen = baue(EyeOff);

/* Status -- kraeftiger Strich, damit sie bei 12px in den Pills nicht
   verschwinden */
const statusGrund = { size: 12, strokeWidth: 2 } as const;
function baueStatus(Komponente: IconKomponente): IconKomponente {
  return (p: LucideProps) => <Komponente {...grund} {...statusGrund} {...p} />;
}
export const ISVergeben = baueStatus(UserRound);
export const ISZugeordnet = baueStatus(DoorOpen);
export const ISStorniert = baueStatus(CircleSlash);
export const ISOffen = baueStatus(Clock);
export const ISErledigt = baueStatus(CircleCheck);
export const ISAusgezahlt = baueStatus(Banknote);
export const ISAbgelehnt = baueStatus(CircleX);

/* Hinweise */
export const IFehler = baue(TriangleAlert);
export const IErfolg = baue(CircleCheck);
export const IInfo = baue(Info);

/* Leerzustaende -- gross und leise */
const leerGrund = { size: 32, strokeWidth: 1.5 } as const;
function baueLeer(Komponente: IconKomponente): IconKomponente {
  return (p: LucideProps) => <Komponente {...grund} {...leerGrund} {...p} />;
}
export const ILeerZimmer = baueLeer(DoorClosed);
export const ILeerKlienten = baueLeer(UserRoundSearch);
export const ILeerMitarbeitende = baueLeer(UserRoundX);
export const ILeerKassenbuch = baueLeer(ReceiptText);
export const ILeerWoche = baueLeer(CalendarX2);
export const ILeerRechnungen = baueLeer(Receipt);
export const ILeerKostenuebernahmen = baueLeer(FileClock);
export const ILeerVerlauf = baueLeer(History);
export const ILeerStandorte = baueLeer(MapPinOff);
export const ILeerTagesberichte = baueLeer(BookX);

/* Sonstiges */
export const ITraeger = baue(Building2);
export const IStandort = baue(MapPin);
export const ITag = baue(Tag);
