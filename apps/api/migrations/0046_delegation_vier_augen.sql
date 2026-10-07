-- Vier-Augen-Prinzip fuer die Genehmigung einer Delegation: eine
-- Delegation wird IMMER von der vertretenen Person selbst beantragt
-- (delegation.service.ts::anlegen() setzt vertretener_benutzer_id und
-- erstellt_von beide auf requireTenantContext().benutzerId -- man kann nur
-- die eigenen Rechte verleihen, nicht fremde anfragen). Wer den Antrag
-- gestellt hat, darf ihn deshalb nicht auch selbst genehmigen -- anders als
-- beim Kassenbuch-Storno (Migration 0045) ist die "andere Person" hier
-- aber nicht ueber eine separate Rechtepruefung bestimmt, sondern durch die
-- Delegation selbst bereits eindeutig festgelegt: nur die im Antrag
-- benannte vertreter_benutzer_id darf entscheiden.
--
-- delegation.service.ts (genehmigen()) faengt den Normalfall schon VOR
-- diesem Trigger ab (ctx.benutzerId <> vertreter_benutzer_id -> 403 mit
-- verstaendlicher Meldung statt einem rohen DB-Fehler). Dieser Trigger ist
-- die harte, nicht umgehbare Grenze darunter -- sie greift auch dann noch,
-- wenn ein kuenftiger Code-Pfad (oder ein roher UPDATE als App-Rolle) diese
-- Pruefung vergisst oder umgeht. Gleiches Zwei-Schichten-Prinzip wie
-- Migration 0045.
--
-- Custom-SQLSTATE wie belegung_kapazitaet_pruefen() (Migration 0032,
-- ZA001) und kassenbuchung_stornoantrag_vier_augen_pruefen() (Migration
-- 0045, ZA002) -- hier also ZA003 (per Grep ueber migrations/ und src/ als
-- noch unbenutzt geprueft).
CREATE FUNCTION delegation_vier_augen_pruefen() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'genehmigt' AND NEW.genehmigt_von <> NEW.vertreter_benutzer_id THEN
    RAISE EXCEPTION 'Nur die im Antrag benannte Vertretung darf eine Delegation genehmigen (Vier-Augen-Prinzip).'
      USING ERRCODE = 'ZA003';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER delegation_vier_augen_pruefen
  BEFORE UPDATE ON delegation
  FOR EACH ROW EXECUTE FUNCTION delegation_vier_augen_pruefen();
