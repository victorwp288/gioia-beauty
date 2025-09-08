// ============================================================================
// GIOIA BEAUTY - APPLICATION CONSTANTS
// ============================================================================

// ============================================================================
// BUSINESS CONFIGURATION
// ============================================================================

export const BUSINESS_INFO = {
  NAME: "Gioia Beauty",
  ADDRESS: "Via Roma 123, Milano, Italy",
  PHONE: "+39 02 1234567",
  EMAIL: "info@gioiabeauty.com",
  WEBSITE: "https://www.gioiabeauty.net",
  TIMEZONE: "Europe/Rome",
  CURRENCY: "EUR",
  LOCALE: "it-IT",
};

// Business hours configuration (matches timeUtils.js)
export const BUSINESS_HOURS = {
  MONDAY: { open: "09:00", close: "19:00", name: "Lunedì" },
  TUESDAY: { open: "10:00", close: "20:00", name: "Martedì" },
  WEDNESDAY: { open: "09:00", close: "19:00", name: "Mercoledì" },
  THURSDAY: { open: "10:00", close: "20:00", name: "Giovedì" },
  FRIDAY: { open: "09:00", close: "18:30", name: "Venerdì" },
  SATURDAY: null, // Closed
  SUNDAY: null, // Closed
};

// Day of week mapping
export const DAYS_OF_WEEK = {
  0: "SUNDAY",
  1: "MONDAY",
  2: "TUESDAY",
  3: "WEDNESDAY",
  4: "THURSDAY",
  5: "FRIDAY",
  6: "SATURDAY",
};

// ============================================================================
// DATA IMPORTS
// ============================================================================

// Import all appointment data from data files
import appointmentTypesJSON from "@/data/appointmentTypes.json";
import manicureData from "@/data/manicureData.js";
import pedicureData from "@/data/pedicureData.js";
import trattamentiVisoData from "@/data/trattamentiVisoData.js";
import trattamentiCorpoData from "@/data/trattamentiCorpoData.js";
import massaggiData from "@/data/massaggiData.js";
import cerettaData from "@/data/cerettaData.js";
import ritualiData from "@/data/ritualiData.js";
import bagnoTurcoData from "@/data/bagnoTurcoData.js";
import cigliaSopraccigliaData from "@/data/cigliaSopraccigliaData.js";
import makeupData from "@/data/makeupData.js";

// ============================================================================
// APPOINTMENT DATA PROCESSING
// ============================================================================
const toNumberArray = (arr, fallback = []) =>
  (Array.isArray(arr) ? arr : [])
    .map((d) => parseInt(String(d), 10))
    .filter((n) => !Number.isNaN(n) && n > 0) || fallback;

const extractDurations = (val) => {
  // Accepts: 60, "60", "30m / 50", "50m / 90m", etc.
  if (Array.isArray(val)) return toNumberArray(val);
  if (val == null) return [];
  const s = String(val);
  // grab all number groups
  const nums = (s.match(/\d+/g) || [])
    .map((n) => parseInt(n, 10))
    .filter((n) => n > 0);
  return nums.length ? nums : [];
};

// Function to convert individual data files to appointment types
const convertDataToAppointmentTypes = () => {
  let categories = [];

  // Safely try to import data, with fallbacks for SSR
  try {
    categories = [
      {
        data: manicureData || [],
        category: "manicure",
        categoryName: "Manicure",
      },
      {
        data: pedicureData || [],
        category: "pedicure",
        categoryName: "Pedicure",
      },
      {
        data: trattamentiVisoData || [],
        category: "facial",
        categoryName: "Trattamenti Viso",
      },
      {
        data: trattamentiCorpoData || [],
        category: "body",
        categoryName: "Trattamenti Corpo",
      },
      {
        data: massaggiData || [],
        category: "massage",
        categoryName: "Massaggi",
      },
      {
        data: cerettaData || [],
        category: "hair_removal",
        categoryName: "Ceretta",
      },
      { data: ritualiData || [], category: "rituals", categoryName: "Rituali" },
      {
        data: bagnoTurcoData || [],
        category: "spa",
        categoryName: "Bagno Turco",
      },
      {
        data: cigliaSopraccigliaData || [],
        category: "eyebrows_lashes",
        categoryName: "Ciglia e Sopracciglia",
      },
      { data: makeupData || [], category: "makeup", categoryName: "Makeup" },
    ];
  } catch (error) {
    console.warn("⚠️ Error loading appointment data files:", error);
    categories = [];
  }

  const groupedServices = {}; // Group by service name
  const seenServiceNames = new Set(); // Track duplicates

  categories.forEach(({ data, category, categoryName }) => {
    if (!Array.isArray(data)) return;

    // Sort the data array to ensure consistent processing order
    const sortedData = [...data].sort((a, b) => {
      if (!a || !b || !a.title || !b.title) return 0;
      return a.title.localeCompare(b.title);
    });

    sortedData.forEach((service) => {
      if (!service || !service.title) return;

      const serviceName = service.title;

      // If we haven't seen this service before, create a new group
      if (!groupedServices[serviceName]) {
        groupedServices[serviceName] = {
          type: serviceName,
          durations: [],
          variants: [],
          extraTime: [],
          basePrice: 50,
          description: service.description || "",
          category: category,
          categoryName: categoryName,
          active: true,
        };
        seenServiceNames.add(serviceName);
      }

      // Add the main service duration
      const mainDurations = extractDurations(service.duration);
      const mainDuration = mainDurations[0] || 60;

      if (!groupedServices[serviceName].durations.includes(mainDuration)) {
        groupedServices[serviceName].durations.push(mainDuration);
        groupedServices[serviceName].variants.push(serviceName);
        groupedServices[serviceName].extraTime.push(5);
      }

      // Handle subcategories (additional duration options)
      if (service.subcategories && service.subcategories.length > 0) {
        service.subcategories.forEach((sub) => {
          const raw = String(sub?.duration ?? "").trim();
          const isAddOn = raw.startsWith("+"); // e.g., "+10" is an add-on
          if (isAddOn) return;

          const subDuration = parseInt(raw, 10);
          if (
            !Number.isNaN(subDuration) &&
            !groupedServices[serviceName].durations.includes(subDuration)
          ) {
            groupedServices[serviceName].durations.push(subDuration);
            groupedServices[serviceName].variants.push(
              sub.title || `${serviceName} (${subDuration}min)`
            );
            groupedServices[serviceName].extraTime.push(5);
          }
        });
      }

      // Sort durations for consistent ordering
      const sortedIndices = groupedServices[serviceName].durations
        .map((duration, idx) => ({ duration, idx }))
        .sort((a, b) => a.duration - b.duration);

      groupedServices[serviceName].durations = sortedIndices.map(
        (item) => item.duration
      );
      groupedServices[serviceName].variants = sortedIndices.map(
        (item) => groupedServices[serviceName].variants[item.idx]
      );
      groupedServices[serviceName].extraTime = sortedIndices.map(
        (item) => groupedServices[serviceName].extraTime[item.idx]
      );
    });
  });

  // Add services from appointmentTypes.json
  // Add/overwrite services from appointmentTypes (AUTHORITATIVE SOURCE)
  try {
    // Support either JSON default export or a JS/TS module exporting default/array
    const officialList = Array.isArray(appointmentTypesJSON?.default)
      ? appointmentTypesJSON.default
      : Array.isArray(appointmentTypesJSON)
      ? appointmentTypesJSON
      : [];

    if (officialList.length > 0) {
      officialList.forEach((appointment) => {
        if (!appointment || !appointment.type) return;

        // Parse official durations and extraTime robustly
        const durationsParsed = extractDurations(appointment.durations).length
          ? extractDurations(appointment.durations)
          : [60];

        const extraTimeParsed = extractDurations(appointment.extraTime).length
          ? extractDurations(appointment.extraTime)
          : [5];

        // If the service already exists (from category files), OVERWRITE the timing fields
        if (groupedServices[appointment.type]) {
          groupedServices[appointment.type].durations = durationsParsed;
          groupedServices[appointment.type].variants = [appointment.type];
          groupedServices[appointment.type].extraTime = extraTimeParsed;
          groupedServices[appointment.type].description =
            groupedServices[appointment.type].description ||
            `${appointment.type} - ${durationsParsed[0]} minuti`;
          // keep the original category/categoryName coming from the category file
        } else {
          // New service entirely
          groupedServices[appointment.type] = {
            type: appointment.type,
            durations: durationsParsed,
            variants: [appointment.type],
            extraTime: extraTimeParsed,
            basePrice: 50,
            description: `${appointment.type} - ${durationsParsed[0]} minuti`,
            category: "general",
            categoryName: "Servizi Generali",
            active: true,
          };
        }

        // Keep track of the name as seen
        seenServiceNames.add(appointment.type);
      });
    }
  } catch (error) {
    console.warn("⚠️ Error loading appointmentTypes (authoritative):", error);
  }

  console.log(
    `✅ Processed ${
      Object.keys(groupedServices).length
    } unique services with variants`
  );

  // Ensure we always have at least one appointment type
  if (Object.keys(groupedServices).length === 0) {
    console.warn("⚠️ No appointment types loaded, adding fallback");
    groupedServices["Consultazione"] = {
      type: "Consultazione",
      durations: [60],
      variants: ["Consultazione"],
      extraTime: [5],
      basePrice: 50,
      description: "Consultazione generale",
      category: "general",
      categoryName: "Servizi Generali",
      active: true,
    };
  }

  // Convert to final format with unique keys
  const processedTypes = {};
  Object.keys(groupedServices)
    .sort()
    .forEach((serviceName) => {
      const service = groupedServices[serviceName];
      const serviceKey = `${service.category.toUpperCase()}_${serviceName.replace(
        /[^a-zA-Z0-9]/g,
        "_"
      )}`;
      processedTypes[serviceKey] = service;
    });

  return processedTypes;
};

// Generate the appointment types from data files
export const APPOINTMENT_TYPES = convertDataToAppointmentTypes();

// ============================================================================
// APPOINTMENT CONFIGURATION
// ============================================================================

export const APPOINTMENT_STATUS = {
  PENDING: "pending",
  CONFIRMED: "confirmed",
  COMPLETED: "completed",
  CANCELLED: "cancelled",
  NO_SHOW: "no_show",
};

export const APPOINTMENT_STATUS_LABELS = {
  [APPOINTMENT_STATUS.PENDING]: "In attesa",
  [APPOINTMENT_STATUS.CONFIRMED]: "Confermato",
  [APPOINTMENT_STATUS.COMPLETED]: "Completato",
  [APPOINTMENT_STATUS.CANCELLED]: "Annullato",
  [APPOINTMENT_STATUS.NO_SHOW]: "Non presentato",
};

export const APPOINTMENT_STATUS_COLORS = {
  [APPOINTMENT_STATUS.PENDING]: "#f59e0b",
  [APPOINTMENT_STATUS.CONFIRMED]: "#10b981",
  [APPOINTMENT_STATUS.COMPLETED]: "#6b7280",
  [APPOINTMENT_STATUS.CANCELLED]: "#ef4444",
  [APPOINTMENT_STATUS.NO_SHOW]: "#f97316",
};

// ============================================================================
// SCHEDULING CONFIGURATION
// ============================================================================

export const SCHEDULING_CONFIG = {
  TIME_SLOT_INTERVAL: 15, // minutes
  MINIMUM_APPOINTMENT_DURATION: 15, // minutes
  MAXIMUM_APPOINTMENT_DURATION: 480, // 8 hours
  BUFFER_TIME_BETWEEN_APPOINTMENTS: 10, // minutes
  MAX_ADVANCE_BOOKING_DAYS: 60,
  MIN_ADVANCE_BOOKING_HOURS: 2,
  CANCELLATION_POLICY_HOURS: 24,
  DEFAULT_APPOINTMENT_DURATION: 60, // minutes
};

// Time zones
export const TIMEZONES = {
  BUSINESS: "Europe/Rome",
  UTC: "UTC",
};

// ============================================================================
// SUBSCRIBER/NEWSLETTER CONFIGURATION
// ============================================================================

export const SUBSCRIBER_STATUS = {
  ACTIVE: "active",
  UNSUBSCRIBED: "unsubscribed",
  BOUNCED: "bounced",
  COMPLAINED: "complained",
};

export const SUBSCRIBER_STATUS_LABELS = {
  [SUBSCRIBER_STATUS.ACTIVE]: "Attivo",
  [SUBSCRIBER_STATUS.UNSUBSCRIBED]: "Disiscritto",
  [SUBSCRIBER_STATUS.BOUNCED]: "Rimbalzato",
  [SUBSCRIBER_STATUS.COMPLAINED]: "Segnalato",
};

export const SUBSCRIBER_SOURCES = {
  WEBSITE: "website",
  SOCIAL_MEDIA: "social_media",
  REFERRAL: "referral",
  BULK_IMPORT: "bulk_import",
  MANUAL: "manual",
  NEWSLETTER: "newsletter",
  PROMOTION: "promotion",
};

export const SUBSCRIBER_SOURCES_LABELS = {
  [SUBSCRIBER_SOURCES.WEBSITE]: "Sito web",
  [SUBSCRIBER_SOURCES.SOCIAL_MEDIA]: "Social media",
  [SUBSCRIBER_SOURCES.REFERRAL]: "Passaparola",
  [SUBSCRIBER_SOURCES.BULK_IMPORT]: "Importazione",
  [SUBSCRIBER_SOURCES.MANUAL]: "Inserimento manuale",
  [SUBSCRIBER_SOURCES.NEWSLETTER]: "Newsletter",
  [SUBSCRIBER_SOURCES.PROMOTION]: "Promozione",
};

// ============================================================================
// UI/UX CONFIGURATION
// ============================================================================

export const UI_CONFIG = {
  // Pagination
  DEFAULT_PAGE_SIZE: 20,
  MAX_PAGE_SIZE: 100,

  // Tables
  DEFAULT_TABLE_ROWS: 10,
  TABLE_ROW_OPTIONS: [10, 20, 50, 100],

  // Forms
  DEBOUNCE_DELAY: 300, // ms
  TOAST_DURATION: 5000, // ms

  // Calendar
  CALENDAR_MONTHS_TO_SHOW: 2,
  CALENDAR_START_DAY: 1, // Monday

  // Images
  MAX_IMAGE_SIZE: 5 * 1024 * 1024, // 5MB
  ALLOWED_IMAGE_TYPES: ["image/jpeg", "image/png", "image/webp"],

  // Animation durations
  ANIMATION_DURATION_FAST: 150,
  ANIMATION_DURATION_NORMAL: 300,
  ANIMATION_DURATION_SLOW: 500,
};

// Theme colors
export const THEME_COLORS = {
  PRIMARY: {
    50: "#fdf2f8",
    100: "#fce7f3",
    500: "#ec4899",
    600: "#db2777",
    700: "#be185d",
    900: "#831843",
  },
  SECONDARY: {
    50: "#f8fafc",
    100: "#f1f5f9",
    500: "#64748b",
    600: "#475569",
    700: "#334155",
    900: "#0f172a",
  },
  SUCCESS: "#10b981",
  WARNING: "#f59e0b",
  ERROR: "#ef4444",
  INFO: "#3b82f6",
};

// ============================================================================
// API CONFIGURATION
// ============================================================================

export const API_CONFIG = {
  BASE_URL: process.env.NEXT_PUBLIC_API_URL || "/api",
  TIMEOUT: 30000, // 30 seconds
  RETRY_ATTEMPTS: 3,
  RETRY_DELAY: 1000, // 1 second

  // Rate limiting
  RATE_LIMIT_REQUESTS: 100,
  RATE_LIMIT_WINDOW: 15 * 60 * 1000, // 15 minutes

  // Cache TTL
  CACHE_TTL: {
    SHORT: 5 * 60 * 1000, // 5 minutes
    MEDIUM: 30 * 60 * 1000, // 30 minutes
    LONG: 24 * 60 * 60 * 1000, // 24 hours
  },
};

// API endpoints
export const API_ENDPOINTS = {
  // Appointments
  APPOINTMENTS: "/appointments",
  APPOINTMENT_BY_ID: (id) => `/appointments/${id}`,
  APPOINTMENTS_BY_DATE: "/appointments/by-date",
  APPOINTMENT_STATS: "/appointments/stats",

  // Vacations
  VACATIONS: "/vacations",
  VACATION_BY_ID: (id) => `/vacations/${id}`,
  CURRENT_VACATION: "/vacations/current",

  // Subscribers
  SUBSCRIBERS: "/subscribers",
  SUBSCRIBER_BY_ID: (id) => `/subscribers/${id}`,
  SUBSCRIBER_STATS: "/subscribers/stats",
  SUBSCRIBE: "/subscribe",
  UNSUBSCRIBE: "/unsubscribe",

  // Email
  SEND_EMAIL: "/send",
  CANCEL_EMAIL: "/cancel",

  // WhatsApp (if implemented)
  WHATSAPP: "/whatsapp",

  // Reminders
  REMINDERS: "/reminder",
};

// ============================================================================
// VALIDATION CONFIGURATION
// ============================================================================

export const VALIDATION_CONFIG = {
  // Field lengths
  MAX_NAME_LENGTH: 100,
  MAX_EMAIL_LENGTH: 320,
  MAX_PHONE_LENGTH: 20,
  MAX_NOTE_LENGTH: 1000,
  MAX_REASON_LENGTH: 500,
  MAX_SUBJECT_LENGTH: 200,
  MAX_MESSAGE_LENGTH: 2000,

  // Password requirements
  MIN_PASSWORD_LENGTH: 8,
  MAX_PASSWORD_LENGTH: 128,
  REQUIRE_UPPERCASE: true,
  REQUIRE_LOWERCASE: true,
  REQUIRE_NUMBERS: true,
  REQUIRE_SYMBOLS: false,

  // Phone number patterns
  PHONE_PATTERN: /^[\+]?[1-9][\d]{0,15}$/,
  ITALIAN_PHONE_PATTERN: /^(\+39)?[\s]?[0-9]{10}$/,

  // Name patterns
  NAME_PATTERN: /^[a-zA-ZÀ-ÿ\s'-]+$/,

  // Time patterns
  TIME_PATTERN: /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/,
};

// ============================================================================
// NOTIFICATION CONFIGURATION
// ============================================================================

export const NOTIFICATION_CONFIG = {
  // Email templates
  EMAIL_TEMPLATES: {
    APPOINTMENT_CONFIRMATION: "appointment_confirmation",
    APPOINTMENT_CANCELLATION: "appointment_cancellation",
    APPOINTMENT_REMINDER: "appointment_reminder",
    NEWSLETTER_WELCOME: "newsletter_welcome",
    CONTACT_FORM: "contact_form",
  },

  // SMS templates
  SMS_TEMPLATES: {
    APPOINTMENT_CONFIRMATION: "sms_appointment_confirmation",
    APPOINTMENT_REMINDER: "sms_appointment_reminder",
  },

  // Notification timing
  REMINDER_TIMING: {
    EMAIL_HOURS_BEFORE: 24,
    SMS_HOURS_BEFORE: 2,
  },

  // Sender information
  FROM_EMAIL: "noreply@gioiabeauty.com",
  FROM_NAME: "Gioia Beauty",
  REPLY_TO: "info@gioiabeauty.com",
};

// ============================================================================
// ERROR CODES
// ============================================================================

export const ERROR_CODES = {
  // Generic errors
  INTERNAL_ERROR: "INTERNAL_ERROR",
  VALIDATION_ERROR: "VALIDATION_ERROR",
  NOT_FOUND: "NOT_FOUND",
  UNAUTHORIZED: "UNAUTHORIZED",
  FORBIDDEN: "FORBIDDEN",
  RATE_LIMITED: "RATE_LIMITED",

  // Appointment specific errors
  APPOINTMENT_CONFLICT: "APPOINTMENT_CONFLICT",
  APPOINTMENT_PAST_DATE: "APPOINTMENT_PAST_DATE",
  APPOINTMENT_OUTSIDE_HOURS: "APPOINTMENT_OUTSIDE_HOURS",
  APPOINTMENT_TOO_ADVANCE: "APPOINTMENT_TOO_ADVANCE",
  APPOINTMENT_TOO_SOON: "APPOINTMENT_TOO_SOON",

  // Vacation specific errors
  VACATION_OVERLAP: "VACATION_OVERLAP",
  VACATION_PAST_DATE: "VACATION_PAST_DATE",
  VACATION_TOO_LONG: "VACATION_TOO_LONG",

  // Subscriber specific errors
  EMAIL_ALREADY_SUBSCRIBED: "EMAIL_ALREADY_SUBSCRIBED",
  EMAIL_NOT_FOUND: "EMAIL_NOT_FOUND",
  INVALID_UNSUBSCRIBE_TOKEN: "INVALID_UNSUBSCRIBE_TOKEN",
};

// Error messages (Italian)
export const ERROR_MESSAGES = {
  [ERROR_CODES.INTERNAL_ERROR]:
    "Si è verificato un errore interno. Riprova più tardi.",
  [ERROR_CODES.VALIDATION_ERROR]: "I dati inseriti non sono validi.",
  [ERROR_CODES.NOT_FOUND]: "Risorsa non trovata.",
  [ERROR_CODES.UNAUTHORIZED]: "Accesso non autorizzato.",
  [ERROR_CODES.FORBIDDEN]: "Non hai i permessi per questa operazione.",
  [ERROR_CODES.RATE_LIMITED]: "Troppe richieste. Riprova più tardi.",

  [ERROR_CODES.APPOINTMENT_CONFLICT]: "L'orario selezionato non è disponibile.",
  [ERROR_CODES.APPOINTMENT_PAST_DATE]: "Non puoi prenotare per date passate.",
  [ERROR_CODES.APPOINTMENT_OUTSIDE_HOURS]:
    "L'orario selezionato è fuori dagli orari di apertura.",
  [ERROR_CODES.APPOINTMENT_TOO_ADVANCE]:
    "Non puoi prenotare con così tanto anticipo.",
  [ERROR_CODES.APPOINTMENT_TOO_SOON]:
    "Non puoi prenotare con così poco preavviso.",

  [ERROR_CODES.VACATION_OVERLAP]:
    "Il periodo di vacanza si sovrappone con uno esistente.",
  [ERROR_CODES.VACATION_PAST_DATE]: "Non puoi creare vacanze per date passate.",
  [ERROR_CODES.VACATION_TOO_LONG]: "Il periodo di vacanza è troppo lungo.",

  [ERROR_CODES.EMAIL_ALREADY_SUBSCRIBED]:
    "Questa email è già iscritta alla newsletter.",
  [ERROR_CODES.EMAIL_NOT_FOUND]: "Email non trovata nella lista iscritti.",
  [ERROR_CODES.INVALID_UNSUBSCRIBE_TOKEN]: "Token di disiscrizione non valido.",
};

// ============================================================================
// FEATURE FLAGS
// ============================================================================

export const FEATURE_FLAGS = {
  ENABLE_SMS_NOTIFICATIONS: process.env.NEXT_PUBLIC_ENABLE_SMS === "true",
  ENABLE_WHATSAPP: process.env.NEXT_PUBLIC_ENABLE_WHATSAPP === "true",
  ENABLE_ONLINE_PAYMENTS: process.env.NEXT_PUBLIC_ENABLE_PAYMENTS === "true",
  ENABLE_MULTI_LANGUAGE: process.env.NEXT_PUBLIC_ENABLE_MULTI_LANG === "true",
  ENABLE_ANALYTICS: process.env.NEXT_PUBLIC_ENABLE_ANALYTICS === "true",
  ENABLE_CHAT_SUPPORT: process.env.NEXT_PUBLIC_ENABLE_CHAT === "true",
  ENABLE_MOBILE_APP: process.env.NEXT_PUBLIC_ENABLE_MOBILE === "true",
  ENABLE_API_RATE_LIMITING: process.env.NODE_ENV === "production",
  ENABLE_CACHING: true,
  ENABLE_OFFLINE_MODE: false,
};

// ============================================================================
// SOCIAL MEDIA & EXTERNAL LINKS
// ============================================================================

export const SOCIAL_LINKS = {
  FACEBOOK: "https://facebook.com/gioiabeauty",
  INSTAGRAM: "https://instagram.com/gioiabeauty",
  TWITTER: "https://twitter.com/gioiabeauty",
  LINKEDIN: "https://linkedin.com/company/gioiabeauty",
  YOUTUBE: "https://youtube.com/@gioiabeauty",
  TIKTOK: "https://tiktok.com/@gioiabeauty",
};

export const EXTERNAL_LINKS = {
  PRIVACY_POLICY: "/privacy-policy",
  TERMS_OF_SERVICE: "/terms-of-service",
  COOKIE_POLICY: "/cookie-policy",
  HELP: "/help",
  CONTACT: "/contact",
  ABOUT: "/about",
};

// ============================================================================
// REGEX PATTERNS
// ============================================================================

export const REGEX_PATTERNS = {
  EMAIL: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  PHONE_INTERNATIONAL: /^[\+]?[1-9][\d]{0,15}$/,
  PHONE_ITALIAN: /^(\+39)?[\s]?[0-9]{10}$/,
  TIME_24H: /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/,
  DATE_ISO: /^\d{4}-\d{2}-\d{2}$/,
  NAME: /^[a-zA-ZÀ-ÿ\s'-]+$/,
  POSTAL_CODE_ITALIAN: /^\d{5}$/,
  TAX_CODE_ITALIAN: /^[A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z]$/,
  VAT_NUMBER_ITALIAN: /^\d{11}$/,
};

// ============================================================================
// UTILITIES
// ============================================================================

// Get all appointment types as array
export const getAppointmentTypesArray = () => {
  return Object.values(APPOINTMENT_TYPES).filter((type) => type.active);
};

// Get appointment type by name (EXACT match on .type)
export const getAppointmentType = (typeName) => {
  if (!typeName) return null;
  return (
    Object.values(APPOINTMENT_TYPES).find((type) => type.type === typeName) ||
    null
  );
};

// (Opzionale) Lookup by chiave del dizionario (se usi <option value=key>)
export const getAppointmentTypeByKey = (key) => {
  if (!key) return null;
  return APPOINTMENT_TYPES[key] || null;
};

// Get appointment categories
export const getAppointmentCategories = () => {
  const categories = new Set();
  Object.values(APPOINTMENT_TYPES).forEach((type) => {
    if (type.active) categories.add(type.category);
  });
  return Array.from(categories);
};

// Check if feature is enabled
export const isFeatureEnabled = (featureName) => {
  return FEATURE_FLAGS[featureName] === true;
};

// Get business hours for a specific day
export const getBusinessHoursForDay = (dayName) => {
  return BUSINESS_HOURS[dayName.toUpperCase()] || null;
};
