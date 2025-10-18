const makeup = [
  {
    title: 'Applicazione trucco giorno / sera / cerimonia',
    description:
      'Realizzerò il trucco che desideri adattandola alla tua fisionomia del volto, con i colori e le luci adatte alla tua occasione speciale. È disponibile anche il servizio a domicilio. ',
    duration: 60,
    bookingOptions: [
      {
        type: 'Applicazione trucco giorno / sera / cerimonia',
        durations: [60],
        extraTime: 5,
      },
    ],
  },
  {
    title: 'Applicazione trucco sposa e acconciatura',
    description:
      'Servizio personalizzato studiato apposta per te per soddisfare ogni tua esigenza di make-up e di acconciature. Seguirò ogni tua esigenza passo passo fino a realizzare il look perfetto per il tuo grande giorno.',
    bookingOptions: [
      {
        type: 'Applicazione trucco sposa e acconciatura',
        durations: [140],
        extraTime: 5,
      },
      {
        type: 'Prova trucco sposa',
        durations: [120],
        extraTime: 5,
      },
    ],
    subcategories: [
      {
        title: 'Prova trucco sposa',
        duration: 140,
      },
      {
        title: 'Prova acconciatura sposa',
        duration: 120,
        includeInBooking: false,
      },
    ],
  },
  {
    title: 'Corso individuale di make-up base',
    description:
      'Impareremo a valorizzare al meglio il tuo viso, ti insegnerò i trucchi del mestiere per esaltare la tua naturale bellezza attraverso giochi di colori, luci e intensità. Realizzeremo insieme makeup versatile, in modo da poter poterlo modificare per renderlo adatto ad ogni occasione. ',
    duration: 20,
    bookingOptions: [
      {
        type: 'Corso individuale di make-up base',
        durations: [20],
        extraTime: 5,
      },
    ],
  },
]

export default makeup
