const trattamentiCorpo = [
  {
    title: "Thalassa alga gigante",
    description:
      "Protocollo a base di alghe brune e attivi marini concentrati che migliorano cellulite, stasi venosa e linfatica, edema, adipe, ritenzione e allentato metabolismo.",
    duration: 90,
    bookingOptions: [
      {
        type: "Thalassa alga gigante",
        durations: [90],
        extraTime: 15,
      },
    ],
  },
  {
    title: "Trattamento minerale al limo di salina",
    description:
      "Indicato per ritenzione idrica, edema, dolori osteoarticolari, adipe, psoriasi e infiammazioni. Non contiene iodio e si basa sul naturale effetto antinfiammatorio di questo prezioso limo, raccolto a mano nelle saline bretoni.",
    duration: 60,
    bookingOptions: [
      {
        type: "Trattamento minerale al limo di salina",
        durations: [60],
        extraTime: 15,
      },
    ],
  },

  {
    title: "Rigenerazione e tono con alga spirulina",
    description:
      "L’alga spirulina apporta vitamine e nutrimento al tessuto rigenerandolo in profondità. Indicato per lassità tissutale, pelle matura, perdita di tono e luminosità. Ideale nei cambi di stagione per tutti i tipi di pelle.",
    duration: 60,
    includeInBooking: false,
  },
  {
    title: "Salagione",
    description:
      "Indicato per ritenzione idrica, cellulite edematosa, edema. Il sale rosa dell’Himalaya, in sinergia con gli attivi marini concentrati, riattiva le funzioni cellulari, favorisce l’eliminazione dei liquidi in eccesso e drena efficacemente i tessuti.",
    duration: 60,
    bookingOptions: [
      {
        type: "Salagione",
        durations: [60],
        extraTime: 15,
      },
    ],
  },
  {
    title: "Trattamento artico gambe",
    description:
      "Protocollo venotonico, decongestionante, drenante. Indicato per ritenzione idrica, gambe pesanti, fragilità capillare e cattiva circolazione. A base di olivello spinoso della Siberia e alghe dei mari glaciali. Dona immediato sollievo lasciando la pelle idratata e luminosa.",
    duration: 60,
    bookingOptions: [
      {
        type: "Trattamento artico gambe",
        durations: [60],
        extraTime: 15,
      },
    ],
  },
  {
    title: "Snellente localizzato cacao e calco termico",
    description:
      "Indicato per adipe in eccesso. Grazie alla sinergia tra cacao teobroma, peperoncino, calco termico alla lavanda, permette di riattivare e migliorare il microcircolo e trattare i pannicoli adiposi più ostinati. ",
    duration: 75,
    bookingOptions: [
      {
        type: "Snellente localizzato cacao e calco termico",
        durations: [75],
        extraTime: 15,
      },
    ],
  },
  {
    title: "Bendaggio specifico",
    description:
      "Permette di trattare diversi inestetismi, quali adipe, ritenzione e cellulite, gonfiore, cattiva circolazione e senso di pesantezza alle gambe.",
    duration: 60,
    bookingOptions: [
      {
        type: "Bendaggio specifico",
        durations: [60],
        extraTime: 15,
      },
    ],
  },
  {
    title: "Calcoterapia riducente",
    description:
      "Indicato in caso di adipe addominale, cuscinetti, coulotte de cheval, cellulite, con risultati mirati sugli inestetismi.",
    includeInBooking: false,
  },
  {
    title: "Calcoterapia decongestionante-rassodante",
    description:
      "Indicato in caso di lassità del tessuto, gambe stanche e pesanti, cattiva circolazione. Saranno trattate le zone critiche per un risultato visibile e un sollievo immediato.",
    duration: 60,
    subcategories: [
      {
        title: "Calco specifico due zone",
      },
      {
        title: "Calco specifico tre zone",
      },
    ],
    bookingOptions: [
      {
        type: "Calcoterapia decongestionante-rassodante",
        durations: [60],
        extraTime: 15,
      },
    ],
  },
];

export default trattamentiCorpo;
