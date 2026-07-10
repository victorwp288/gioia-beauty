-- Generated from lib/domain/catalog/manifest.ts.
-- Manifest SHA-256: 74f97f4fcae84e19158bd8fba9d6386c446539feef0c4998d47c760d5c1c34b7
begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

insert into gioia_private.services (
  id,
  category_id,
  display_name_it,
  sort_order,
  active
)
values
  ('applicazione-di-smalto-semipermanente', 'manicure', 'Applicazione di smalto semipermanente', 0, true),
  ('applicazione-di-smalto-semipermanente-rinforzato', 'manicure', 'Applicazione di smalto semipermanente rinforzato', 1, true),
  ('applicazione-smalto-classico', 'manicure', 'Applicazione smalto classico', 2, true),
  ('architettura-sopracciglia', 'ciglia-sopracciglia', 'Architettura sopracciglia', 0, true),
  ('ascelle', 'ceretta', 'Ascelle', 0, true),
  ('attivatore-splendore-immediato', 'lpg', 'Attivatore splendore immediato', 0, true),
  ('baffetti', 'ceretta', 'Baffetti', 1, true),
  ('baffetti-e-sopracciglia', 'ceretta', 'Baffetti e sopracciglia', 2, true),
  ('bendaggio-specifico', 'trattamenti-corpo', 'Bendaggio specifico', 0, true),
  ('body-brushing-mineralizzante', 'massaggi', 'Body brushing mineralizzante', 0, true),
  ('braccia', 'ceretta', 'Braccia', 3, true),
  ('calcoterapia-decongestionante-rassodante', 'trattamenti-corpo', 'Calcoterapia decongestionante-rassodante', 1, true),
  ('combinazione-laminazione-ciglia-e-sopracciglia', 'ciglia-sopracciglia', 'Combinazione laminazione ciglia e sopracciglia', 1, true),
  ('consulenza-endermologie', 'lpg', 'Consulenza endermologie®', 1, true),
  ('consulenza-laser', 'laser', 'Consulenza laser', 0, true),
  ('copertura-gel-delle-unghie-naturali', 'manicure', 'Copertura gel delle unghie naturali', 3, true),
  ('corso-individuale-di-make-up-base', 'makeup', 'Corso individuale di make-up base', 0, true),
  ('detox', 'lpg', 'Detox', 2, true),
  ('elite-active', 'trattamenti-viso', 'Elite active', 0, true),
  ('epilazione-con-filo-arabo-delle-sopracciglia', 'ciglia-sopracciglia', 'Epilazione con filo arabo delle sopracciglia', 2, true),
  ('gamba-intera', 'ceretta', 'Gamba intera', 4, true),
  ('gamba-intera-uomo', 'ceretta', 'Gamba intera uomo', 5, true),
  ('glutei', 'ceretta', 'Glutei', 6, true),
  ('grow-up-sopracciglia', 'ciglia-sopracciglia', 'Grow up sopracciglia', 3, true),
  ('inguine-parziale', 'ceretta', 'Inguine parziale', 7, true),
  ('inguine-totale', 'ceretta', 'Inguine totale', 8, true),
  ('laminazione-ciglia', 'ciglia-sopracciglia', 'Laminazione ciglia', 4, true),
  ('laminazione-sopracciglia', 'ciglia-sopracciglia', 'Laminazione sopracciglia', 5, true),
  ('manicure', 'manicure', 'Manicure', 4, true),
  ('manicure-giapponese', 'manicure', 'Manicure Giapponese', 5, true),
  ('manicure-spa', 'manicure', 'Manicure SPA', 6, true),
  ('massaggio-con-pindasweda', 'massaggi', 'Massaggio con Pindasweda', 1, true),
  ('massaggio-corpo-al-cioccolato', 'massaggi', 'Massaggio corpo al cioccolato', 2, true),
  ('massaggio-corpo-personalizzato', 'massaggi', 'Massaggio corpo personalizzato', 3, true),
  ('massaggio-viso-personalizzato', 'massaggi', 'Massaggio viso personalizzato', 4, true),
  ('mezza-gamba', 'ceretta', 'Mezza gamba', 9, true),
  ('nanoblading-grow-brows', 'ciglia-sopracciglia', 'Nanoblading grow brows', 6, true),
  ('nemesis', 'trattamenti-viso', 'Nemesis', 1, true),
  ('ossigeno-dermo-infusione', 'trattamenti-viso', 'Ossigeno dermo infusione', 2, true),
  ('pedicure', 'pedicure', 'Pedicure', 0, true),
  ('pedicure-spa', 'pedicure', 'Pedicure SPA', 1, true),
  ('pedicure-berbero', 'pedicure', 'Pedicure berbero', 2, true),
  ('pedicure-completa-con-cheratolitico', 'pedicure', 'Pedicure completa con cheratolitico', 3, true),
  ('pedicure-polinesiano', 'pedicure', 'Pedicure polinesiano', 4, true),
  ('pedicure-siberiano', 'pedicure', 'Pedicure siberiano', 5, true),
  ('petto', 'ceretta', 'Petto', 10, true),
  ('pressoterapia', 'massaggi', 'Pressoterapia', 5, true),
  ('pulizia-del-viso-con-spatola-ad-ultrasuoni', 'trattamenti-viso', 'Pulizia del viso con spatola ad ultrasuoni', 3, true),
  ('pulizia-del-viso-ultrasuoni-e-mandelico', 'trattamenti-viso', 'Pulizia del viso ultrasuoni e mandelico', 4, true),
  ('rituale-amazzonia', 'rituali', 'Rituale Amazzonia', 0, true),
  ('rituale-bora-bora', 'rituali', 'Rituale Bora Bora', 1, true),
  ('rituale-coccole-di-cotone', 'rituali', 'Rituale Coccole di cotone', 2, true),
  ('rituale-cute', 'rituali', 'Rituale Cute', 3, true),
  ('rituale-himalaya', 'rituali', 'Rituale Himalaya', 4, true),
  ('rituale-india', 'rituali', 'Rituale India', 5, true),
  ('rituale-kleopatra', 'rituali', 'Rituale Kleopatra', 6, true),
  ('rituale-kyoto', 'rituali', 'Rituale Kyoto', 7, true),
  ('rituale-marrakech', 'rituali', 'Rituale Marrakech', 8, true),
  ('rituale-siberia', 'rituali', 'Rituale Siberia', 9, true),
  ('salagione', 'trattamenti-corpo', 'Salagione', 2, true),
  ('savonage-hammam', 'massaggi', 'Savonage hammam', 6, true),
  ('schiena', 'ceretta', 'Schiena', 11, true),
  ('scrub-al-te-verde', 'massaggi', 'Scrub al tè verde', 7, true),
  ('scrub-corpo-aromatico', 'rituali', 'Scrub corpo aromatico', 10, true),
  ('scrub-drenante-al-sale-integrale', 'massaggi', 'Scrub drenante al sale integrale', 8, true),
  ('seduta-di-bagno-turco', 'bagno-turco', 'Seduta di Bagno Turco', 0, true),
  ('snellente-localizzato-cacao-e-calco-termico', 'trattamenti-corpo', 'Snellente localizzato cacao e calco termico', 3, true),
  ('sopracciglia', 'ceretta', 'Sopracciglia', 12, true),
  ('thalassa-alga-gigante', 'trattamenti-corpo', 'Thalassa alga gigante', 4, true),
  ('trattamenti-viso-specifici', 'trattamenti-viso', 'Trattamenti viso specifici', 5, true),
  ('trattamento-artico-gambe', 'trattamenti-corpo', 'Trattamento artico gambe', 5, true),
  ('trattamento-minerale-al-limo-di-salina', 'trattamenti-corpo', 'Trattamento minerale al limo di salina', 6, true),
  ('trattamento-viso-eterna', 'trattamenti-viso', 'Trattamento viso Eterna', 6, true),
  ('trattamento-viso-fast-beauty', 'trattamenti-viso', 'Trattamento viso Fast Beauty', 7, true);

do $catalog_count$
begin
  if (select count(*) from gioia_private.services) <> 74 then
    raise exception 'Unexpected services row count';
  end if;
end
$catalog_count$;

commit;
