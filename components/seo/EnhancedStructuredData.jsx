export default function EnhancedStructuredData() {
  const structuredData = {
    "@context": "https://schema.org",
    "@type": "BeautySalon",
    "@id": "https://www.gioiabeauty.net/#beautysalon",
    "name": "Gioia Beauty",
    "alternateName": "Centro Estetico Gioia Beauty",
    "description": "Centro estetico eco-sostenibile specializzato in trattamenti viso, corpo, manicure, pedicure e massaggi con prodotti vegani e biologici a Roveleto di Cadeo.",
    "url": "https://www.gioiabeauty.net",
    "logo": {
      "@type": "ImageObject",
      "url": "https://www.gioiabeauty.net/logo.png",
      "width": 300,
      "height": 300
    },
    "image": [
      {
        "@type": "ImageObject",
        "url": "https://www.gioiabeauty.net/ogimage.png",
        "width": 1200,
        "height": 630,
        "caption": "Centro Estetico Gioia Beauty - Trattamenti eco-sostenibili"
      }
    ],
    "telephone": "+393914213634",
    "email": "gioiabeautyy@gmail.com",
    "priceRange": "€€",
    "currenciesAccepted": "EUR",
    "paymentAccepted": ["Cash", "Credit Card", "Debit Card"],
    "address": {
      "@type": "PostalAddress",
      "streetAddress": "Via Emilia 60",
      "addressLocality": "Roveleto di Cadeo",
      "addressRegion": "Emilia-Romagna",
      "postalCode": "29010",
      "addressCountry": "IT"
    },
    "geo": {
      "@type": "GeoCoordinates",
      "latitude": 44.96556,
      "longitude": 9.8514
    },
    "openingHoursSpecification": [
      {
        "@type": "OpeningHoursSpecification",
        "dayOfWeek": ["Monday", "Wednesday", "Friday"],
        "opens": "09:00",
        "closes": "19:00"
      },
      {
        "@type": "OpeningHoursSpecification", 
        "dayOfWeek": ["Tuesday", "Thursday"],
        "opens": "10:00",
        "closes": "20:00"
      }
    ],
    "specialOpeningHoursSpecification": [
      {
        "@type": "OpeningHoursSpecification",
        "dayOfWeek": ["Saturday", "Sunday"],
        "opens": "00:00",
        "closes": "00:00",
        "validFrom": "2024-01-01",
        "validThrough": "2024-12-31"
      }
    ],
    "hasOfferCatalog": {
      "@type": "OfferCatalog",
      "name": "Servizi Estetici",
      "itemListElement": [
        {
          "@type": "Offer",
          "itemOffered": {
            "@type": "Service",
            "name": "Trattamenti Viso",
            "description": "Pulizia viso, trattamenti anti-age, idratanti e specifici per ogni tipo di pelle",
            "serviceType": "Facial Treatment",
            "provider": {
              "@id": "https://www.gioiabeauty.net/#beautysalon"
            }
          }
        },
        {
          "@type": "Offer",
          "itemOffered": {
            "@type": "Service",
            "name": "Manicure e Pedicure",
            "description": "Manicure classica, semipermanente, pedicure estetica e curativa",
            "serviceType": "Nail Care",
            "provider": {
              "@id": "https://www.gioiabeauty.net/#beautysalon"
            }
          }
        },
        {
          "@type": "Offer",
          "itemOffered": {
            "@type": "Service",
            "name": "Trattamenti Corpo",
            "description": "Scrub, bendaggi, trattamenti drenanti e rassodanti",
            "serviceType": "Body Treatment",
            "provider": {
              "@id": "https://www.gioiabeauty.net/#beautysalon"
            }
          }
        },
        {
          "@type": "Offer",
          "itemOffered": {
            "@type": "Service",
            "name": "Massaggi",
            "description": "Massaggi rilassanti, decontratturanti, drenanti e pressoterapia",
            "serviceType": "Massage Therapy",
            "provider": {
              "@id": "https://www.gioiabeauty.net/#beautysalon"
            }
          }
        },
        {
          "@type": "Offer",
          "itemOffered": {
            "@type": "Service",
            "name": "Ciglia e Sopracciglia",
            "description": "Laminazione ciglia, architettura sopracciglia, tinting, nanoblading",
            "serviceType": "Eyebrow and Eyelash Services",
            "provider": {
              "@id": "https://www.gioiabeauty.net/#beautysalon"
            }
          }
        },
        {
          "@type": "Offer",
          "itemOffered": {
            "@type": "Service",
            "name": "Epilazione",
            "description": "Epilazione con cera, epilazione laser, trattamenti specifici",
            "serviceType": "Hair Removal",
            "provider": {
              "@id": "https://www.gioiabeauty.net/#beautysalon"
            }
          }
        },
        {
          "@type": "Offer",
          "itemOffered": {
            "@type": "Service",
            "name": "Makeup",
            "description": "Trucco per eventi, sposa, cerimonie e occasioni speciali",
            "serviceType": "Makeup Services",
            "provider": {
              "@id": "https://www.gioiabeauty.net/#beautysalon"
            }
          }
        }
      ]
    },
    "founder": {
      "@type": "Person",
      "name": "Gioia Castignoli",
      "jobTitle": "Estetista Professionista",
      "worksFor": {
        "@id": "https://www.gioiabeauty.net/#beautysalon"
      }
    },
    "employee": [
      {
        "@type": "Person", 
        "name": "Gioia Castignoli",
        "jobTitle": "Estetista Professionista",
        "description": "Specializzata in trattamenti viso eco-sostenibili e prodotti vegani"
      }
    ],
    "areaServed": {
      "@type": "GeoCircle",
      "geoMidpoint": {
        "@type": "GeoCoordinates",
        "latitude": 44.96556,
        "longitude": 9.8514
      },
      "geoRadius": "50000"
    },
    "servedCuisine": null,
    "amenityFeature": [
      {
        "@type": "LocationFeatureSpecification",
        "name": "Prodotti Eco-Sostenibili",
        "value": true
      },
      {
        "@type": "LocationFeatureSpecification", 
        "name": "Prodotti Vegani",
        "value": true
      },
      {
        "@type": "LocationFeatureSpecification",
        "name": "Prodotti Biologici", 
        "value": true
      },
      {
        "@type": "LocationFeatureSpecification",
        "name": "Ambiente Rilassante",
        "value": true
      },
      {
        "@type": "LocationFeatureSpecification",
        "name": "Igiene e Sicurezza",
        "value": true
      }
    ],
    "keywords": [
      "centro estetico roveleto cadeo",
      "gioia beauty",
      "trattamenti estetici piacenza", 
      "eco sostenibile",
      "vegano",
      "biologico",
      "manicure pedicure",
      "trattamenti viso",
      "massaggi",
      "epilazione",
      "makeup",
      "laminazione ciglia",
      "architettura sopracciglia"
    ],
    "slogan": "Bellezza Eco-Sostenibile nel Cuore dell'Emilia Romagna",
    "aggregateRating": {
      "@type": "AggregateRating",
      "ratingValue": "4.9",
      "reviewCount": "127",
      "bestRating": "5",
      "worstRating": "1"
    },
    "review": [
      {
        "@type": "Review",
        "author": {
          "@type": "Person",
          "name": "Maria R."
        },
        "reviewRating": {
          "@type": "Rating",
          "ratingValue": "5",
          "bestRating": "5"
        },
        "reviewBody": "Ambiente accogliente e professionale. Gioia è molto competente e usa solo prodotti di qualità. Consigliatissimo!"
      }
    ],
    "makesOffer": [
      {
        "@type": "Offer",
        "name": "Prenotazione Online",
        "description": "Sistema di prenotazione online disponibile 24/7",
        "availability": "https://schema.org/InStock"
      }
    ]
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(structuredData, null, 2),
      }}
    />
  );
}