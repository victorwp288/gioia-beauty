const manicure = [
  {
    title: "Manicure",
    description:
      "Trattamento delle unghie delle mani con tecnica dry manicure. È possibile scegliere una manicure classica oppure abbinarla alle seguenti applicazioni:",
    duration: 30,
    bookingOptions: [
      {
        type: "Manicure",
        description:
          "Trattamento base dry manicure con rifinitura delicata e cura completa delle unghie.",
        durations: [30],
        extraTime: 5,
      },
      {
        type: "Applicazione smalto classico",
        description:
          "Applicazione di smalto classico dopo la manicure per un finish brillante.",
        durations: [45],
        extraTime: 5,
      },
      {
        type: "Applicazione di smalto semipermanente",
        description:
          "Stesura di smalto semipermanente con preparazione dell'unghia tramite manicure dry.",
        durations: [60],
        extraTime: 5,
      },
      {
        type: "Applicazione di smalto semipermanente rinforzato",
        description:
          "Applicazione di smalto semipermanente con rinforzo per maggiore resistenza e durata.",
        durations: [90],
        extraTime: 5,
      },
      {
        type: "Copertura gel delle unghie naturali",
        description:
          "Copertura in gel sulle unghie naturali per un effetto rinforzato e ultra brillante.",
        durations: [90],
        extraTime: 5,
      },
    ],
    subcategories: [
      {
        title: "Applicazione smalto classico",
        duration: 15,
      },
      {
        title: "Applicazione di smalto semipermanente",
        duration: 30,
      },
      {
        title: "Applicazione di smalto semipermanente rinforzato",
        duration: 60,
      },
      {
        title: "Copertura gel delle unghie naturali",
        duration: 90,
      },
    ],
  },
  {
    title: "Manicure Giapponese",
    description:
      "Trattamento naturale che fortifica e nutre in profondità le unghie, che appariranno subito lucide con un effetto shine dalla durata che varia dalle due alle tre settimane.",
    duration: 45,
    bookingOptions: [
      {
        type: "Manicure Giapponese",
        durations: [45],
        extraTime: 5,
      },
    ],
  },
  {
    title: "Manicure SPA",
    description:
      "Trattamento rilassante e rigenerante per la pelle delle tue mani, con lo scopo di idratare in profondità la pelle e renderla più radiosa.",
    duration: 50,
    bookingOptions: [
      {
        type: "Manicure SPA",
        durations: [50],
        extraTime: 5,
      },
    ],
  },
];

export default manicure;
