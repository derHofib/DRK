// Vite liefert fuer "?url"-Importe die gebaute Asset-URL. Nur dieser eine
// Fall statt der ganzen vite/client-Typen: mehr wird nicht gebraucht.
declare module "*.ttf?url" {
  const url: string;
  export default url;
}
