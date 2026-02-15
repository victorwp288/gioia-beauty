"use client";
import { Clock3, Database, Edit, Mail, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import PhoneInput from "react-phone-input-2";
import "react-phone-input-2/lib/style.css";

// UI Components
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

// Import Link for navigation
import Link from "next/link";

// Context and Hooks
import { useAppointmentContext } from "@/context/AppointmentContext";
import { useNotification } from "@/context/NotificationContext";
import { useTheme } from "@/context/ThemeContext";

// Utilities
import {
  APPOINTMENT_STATUS_COLORS,
  APPOINTMENT_STATUS_LABELS,
  APPOINTMENT_TYPES,
  getAppointmentType,
} from "@/lib/utils/constants";
import {
  appointmentDateMatches,
  createAppointmentDate,
  formatDate,
  formatDateForInput,
  getTodayFormatted,
} from "@/lib/utils/dateUtils";
import { calculateEndTime } from "@/lib/utils/timeUtils";

// Separate Components
import SubscriberList from "../SubscriberList";
import AppointmentCalendar from "./AppointmentCalendar";
import VacationManager from "./VacationManager";

const Dashy = ({ user, authLoading }) => {
  // ⚠️ ALL HOOKS MUST BE CALLED FIRST - Rules of Hooks
  // Local state for modals and forms
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [selectedAppointment, setSelectedAppointment] = useState(null);
  const [isVacationModalOpen, setIsVacationModalOpen] = useState(false);
  const [isSubscriberModalOpen, setIsSubscriberModalOpen] = useState(false);
  const [isBlockModalOpen, setIsBlockModalOpen] = useState(false);
  const [blockFormData, setBlockFormData] = useState({
    selectedDate: getTodayFormatted(),
    startTime: "",
    duration: "120",
    note: "",
  });
  const [blockFormErrors, setBlockFormErrors] = useState({});

  // Form validation state
  const [formErrors, setFormErrors] = useState({});

  // Data loading state
  const [showingAllData, setShowingAllData] = useState(false);
  const [isLoadingAllData, setIsLoadingAllData] = useState(false);
  const [totalDatabaseCount, setTotalDatabaseCount] = useState(null);
  const [loadingTotalCount, setLoadingTotalCount] = useState(true);

  // Use global theme context
  const { darkMode, toggleDarkMode } = useTheme();

  // Track initialization to prevent duplicate calls
  const hasInitializedRef = useRef(false);

  // Get appointments using centralized context
  const {
    appointments,
    loading: appointmentsLoading,
    error: appointmentsError,
    createAppointment,
    updateAppointment,
    deleteAppointment,
    fetchAppointments,
    fetchAllAppointments,
  } = useAppointmentContext();

  const { showConfirmation, notifyAsync, showError, showSuccess } =
    useNotification();

  // Form state
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    number: "",
    appointmentType: "",
    startTime: "",
    duration: "",
    selectedDate: "",
    note: "",
  });

  // Filter appointments for selected date
  const filteredAppointments = useMemo(() => {
    if (!selectedDate || !appointments || appointments.length === 0) {
      return [];
    }

    const filtered = appointments.filter((appointment) => {
      try {
        const matches = appointmentDateMatches(
          appointment.selectedDate,
          selectedDate,
        );
        return matches;
      } catch (error) {
        console.error(
          "🔍 Dashboard: Error filtering appointment",
          appointment.id,
          error,
        );
        return false;
      }
    });

    return filtered.sort((a, b) => a.startTime.localeCompare(b.startTime));
  }, [selectedDate, appointments]);

  // ============================================================================
  // DATA LOADING FUNCTIONS
  // ============================================================================

  // Function to automatically get total database count
  const fetchTotalCount = async () => {
    try {
      setLoadingTotalCount(true);
      const { dataManager } = await import("@/lib/firebase/dataManager");
      const totalCount = await dataManager.getTotalAppointmentCount();
      setTotalDatabaseCount(totalCount);
    } catch (error) {
      console.error("Error getting total count:", error);
      // Fallback to loaded count if total count fails
      setTotalDatabaseCount(null);
    } finally {
      setLoadingTotalCount(false);
    }
  };

  // Function to load older data (expand date range)
  const loadExtendedData = async () => {
    setIsLoadingAllData(true);
    try {
      console.log(
        "📊 Dashboard: Loading extended date range (3 months back/forward)...",
      );

      // Expand to 3 months back and 3 months forward (much smaller than before)
      const today = new Date();
      const threeMonthsAgo = new Date(today);
      threeMonthsAgo.setMonth(today.getMonth() - 3);
      const threeMonthsForward = new Date(today);
      threeMonthsForward.setMonth(today.getMonth() + 3);

      console.log("📊 Dashboard: Extended range:", {
        start: threeMonthsAgo.toISOString().split("T")[0],
        end: threeMonthsForward.toISOString().split("T")[0],
      });

      await fetchAppointments({
        dateRange: {
          start: threeMonthsAgo.toISOString(),
          end: threeMonthsForward.toISOString(),
        },
      });

      setShowingAllData(true);

      showSuccess("Intervallo esteso caricato (6 mesi totali).");
    } catch (error) {
      console.error("Error loading extended data:", error);
      showError("Impossibile caricare i dati estesi degli appuntamenti");
    } finally {
      setIsLoadingAllData(false);
    }
  };

  // ============================================================================
  // FORM HANDLERS
  // ============================================================================

  const resetForm = () => {
    setFormData({
      name: "",
      email: "",
      number: "",
      appointmentType: "",
      startTime: "",
      duration: "",
      selectedDate: "",
      note: "",
    });
    setFormErrors({});
  };

  const handleInputChange = (field, value) => {
    setFormData((prev) => ({
      ...prev,
      [field]: value,
    }));

    // Clear error for this field when user starts typing
    if (formErrors[field]) {
      setFormErrors((prev) => ({
        ...prev,
        [field]: null,
      }));
    }

    // Auto-calculate end time when start time or duration changes
    if (field === "startTime" || field === "duration") {
      const startTime = field === "startTime" ? value : formData.startTime;
      const duration = field === "duration" ? value : formData.duration;

      if (startTime && duration) {
        const endTime = calculateEndTime(startTime, parseInt(duration));
        setFormData((prev) => ({
          ...prev,
          endTime,
        }));
      }
    }
  };

  const handleAppointmentTypeChange = (appointmentType) => {
    const selectedType = getAppointmentType(appointmentType);
    if (selectedType) {
      setFormData((prev) => ({
        ...prev,
        appointmentType,
        duration: selectedType.durations[0].toString(),
      }));
    }
  };

  // Validate form fields
  const validateForm = () => {
    const errors = {};

    if (!formData.name?.trim()) {
      errors.name = "Nome obbligatorio";
    }

    // Email is now optional, but if provided, it should be valid
    if (
      formData.email?.trim() &&
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email.trim())
    ) {
      errors.email = "Inserisci un indirizzo email valido";
    }

    if (!formData.appointmentType) {
      errors.appointmentType = "Servizio obbligatorio";
    }

    if (!formData.startTime) {
      errors.startTime = "Orario di inizio obbligatorio";
    }

    if (!formData.duration) {
      errors.duration = "Durata obbligatoria";
    } else {
      const durationNum = parseInt(formData.duration);
      if (isNaN(durationNum) || durationNum < 5) {
        errors.duration = "La durata minima e' di 5 minuti";
      } else if (durationNum > 300) {
        errors.duration = "La durata non puo' superare 300 minuti (5 ore)";
      }
    }

    if (!formData.selectedDate) {
      errors.selectedDate = "Data obbligatoria";
    }

    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  // ============================================================================
  // APPOINTMENT OPERATIONS
  // ============================================================================

  const handleAddAppointment = () => {
    // Reset form and errors for new appointment
    resetForm();
    setFormErrors({});
    setIsEditMode(false);
    setSelectedAppointment(null);

    // Set today's date as default using timezone-safe method
    setFormData((prev) => ({
      ...prev,
      selectedDate: formatDateForInput(selectedDate) || getTodayFormatted(),
    }));

    setIsAddModalOpen(true);
  };

  const resetBlockForm = () => {
    setBlockFormData({
      selectedDate: getTodayFormatted(),
      startTime: "",
      duration: "120",
      note: "",
    });
    setBlockFormErrors({});
  };

  const handleOpenBlockModal = () => {
    setBlockFormData({
      selectedDate: formatDateForInput(selectedDate) || getTodayFormatted(),
      startTime: "",
      duration: "120",
      note: "",
    });
    setBlockFormErrors({});
    setIsBlockModalOpen(true);
  };

  const handleBlockInputChange = (field, value) => {
    setBlockFormData((prev) => ({
      ...prev,
      [field]: value,
    }));

    if (blockFormErrors[field]) {
      setBlockFormErrors((prev) => ({
        ...prev,
        [field]: null,
      }));
    }
  };

  const validateBlockForm = () => {
    const errors = {};

    if (!blockFormData.selectedDate) {
      errors.selectedDate = "Data obbligatoria";
    }

    if (!blockFormData.startTime) {
      errors.startTime = "Orario di inizio obbligatorio";
    }

    if (!blockFormData.duration) {
      errors.duration = "Durata obbligatoria";
    } else {
      const durationNum = parseInt(blockFormData.duration, 10);
      if (isNaN(durationNum) || durationNum < 5) {
        errors.duration = "La durata minima e' di 5 minuti";
      } else if (durationNum > 480) {
        errors.duration = "La durata non puo' superare 480 minuti (8 ore)";
      }
    }

    if (
      blockFormData.startTime &&
      blockFormData.duration &&
      !calculateEndTime(
        blockFormData.startTime,
        parseInt(blockFormData.duration, 10),
      )
    ) {
      errors.startTime = "Orario di inizio non valido";
    }

    setBlockFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const formatBlockPresetDuration = (minutes) => {
    if (minutes > 60) {
      const hours = Math.floor(minutes / 60);
      const remainingMinutes = minutes % 60;

      if (remainingMinutes === 0) {
        return `${hours}h`;
      }

      return `${hours}h${remainingMinutes}m`;
    }

    return `${minutes}m`;
  };

  const handleSaveTimeBlock = async () => {
    try {
      if (!validateBlockForm()) {
        showError("Compila data, orario e durata del blocco.");
        return;
      }

      const blockDate = createAppointmentDate(blockFormData.selectedDate);
      if (!blockDate) {
        throw new Error("Invalid date selected for block");
      }

      const durationMinutes = parseInt(blockFormData.duration, 10);
      const endTime = calculateEndTime(
        blockFormData.startTime,
        durationMinutes,
      );
      if (!endTime) {
        throw new Error("Invalid time range for block");
      }

      const blockAppointment = {
        name: "Blocco Orario",
        email: "",
        number: "",
        appointmentType: "Blocco Orario",
        startTime: blockFormData.startTime,
        endTime,
        duration: durationMinutes,
        totalDuration: durationMinutes,
        selectedDate: blockDate,
        note: blockFormData.note?.trim() || "Blocco creato da dashboard",
        status: "confirmed",
        isTimeBlock: true,
        source: "admin_dashboard",
      };

      await notifyAsync(() => createAppointment(blockAppointment), {
        loading: "Creazione blocco orario...",
        success: "Blocco orario creato con successo!",
        error: "Impossibile creare il blocco orario",
      });

      setSelectedDate(blockDate);
      setIsBlockModalOpen(false);
      resetBlockForm();
    } catch (error) {
      console.error("Error creating time block:", error);
    }
  };

  const handleEditAppointment = (appointment) => {
    // Clear any previous errors
    setFormErrors({});

    // Safely convert appointment date for editing with timezone-safe conversion
    let displayDate = "";
    try {
      const appointmentDate = appointment.selectedDate || appointment.date;

      if (appointmentDate) {
        displayDate = formatDateForInput(appointmentDate);

        console.log("🗓️ Date conversion:", {
          original: appointmentDate,
          display: displayDate,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        });

        if (!displayDate) {
          console.warn(
            "Could not format appointment date, using today's date:",
            appointmentDate,
          );
          displayDate = getTodayFormatted();
        }
      } else {
        displayDate = getTodayFormatted();
      }
    } catch (error) {
      console.error("Error parsing appointment date:", error, appointment);
      // Fallback to today's date using timezone-safe method
      displayDate = getTodayFormatted();
      showError(
        "Attenzione: impossibile leggere la data dell'appuntamento, uso la data di oggi.",
      );
    }

    setFormData({
      name: appointment.name || "",
      email: appointment.email || "",
      number: appointment.number || "",
      appointmentType: appointment.appointmentType || "",
      startTime: appointment.startTime || "",
      duration: appointment.duration?.toString() || "",
      selectedDate: displayDate,
      note: appointment.note || "",
    });

    setSelectedAppointment(appointment);
    setIsEditMode(true);
    setIsAddModalOpen(true);
  };

  const handleSaveAppointment = async () => {
    try {
      // Validate form fields
      if (!validateForm()) {
        // Collect missing required fields
        const missingFields = [];
        if (formErrors.name) missingFields.push("Nome");
        if (formErrors.appointmentType) missingFields.push("Servizio");
        if (formErrors.startTime) missingFields.push("Orario di inizio");
        if (formErrors.duration) missingFields.push("Durata");
        if (formErrors.selectedDate) missingFields.push("Data");

        // Show error notification
        showError(
          `Compila tutti i campi obbligatori: ${missingFields.join(", ")}`,
          { duration: 6000 },
        );

        // Scroll to first error field
        const firstErrorField = Object.keys(formErrors)[0];
        const firstErrorElement = document.querySelector(`#${firstErrorField}`);
        if (firstErrorElement) {
          firstErrorElement.scrollIntoView({
            behavior: "smooth",
            block: "center",
          });
          firstErrorElement.focus();
        }

        return;
      }

      const appointmentDate = createAppointmentDate(formData.selectedDate);
      if (!appointmentDate) {
        throw new Error("Invalid date selected");
      }

      const appointmentData = {
        name: formData.name.trim(),
        email: formData.email.trim(),
        number: formData.number,
        appointmentType: formData.appointmentType,
        startTime: formData.startTime,
        duration: parseInt(formData.duration),
        selectedDate: appointmentDate,
        note: formData.note?.trim() || "",
        status: "confirmed",
      };

      // Calculate end time
      const selectedType = getAppointmentType(formData.appointmentType);
      const extraTime = selectedType?.extraTime?.[0] || 0;
      appointmentData.endTime = calculateEndTime(
        formData.startTime,
        appointmentData.duration + extraTime,
      );
      appointmentData.totalDuration = appointmentData.duration + extraTime;

      if (isEditMode && selectedAppointment) {
        await notifyAsync(
          () => updateAppointment(selectedAppointment.id, appointmentData),
          {
            loading: "Aggiornamento appuntamento...",
            success: "Appuntamento aggiornato con successo!",
            error: "Impossibile aggiornare l'appuntamento",
          },
        );
      } else {
        await notifyAsync(() => createAppointment(appointmentData), {
          loading: "Creazione appuntamento...",
          success: "Appuntamento creato con successo!",
          error: "Impossibile creare l'appuntamento",
        });

        // Send confirmation email for new appointments
        try {
          const emailData = {
            email: appointmentData.email,
            name: appointmentData.name,
            startTime: appointmentData.startTime,
            endTime: appointmentData.endTime,
            duration: appointmentData.duration,
            date: (() => {
              try {
                if (appointmentData.selectedDate instanceof Date) {
                  return formatDate(appointmentData.selectedDate);
                } else if (typeof appointmentData.selectedDate === "string") {
                  const parsedDate = new Date(appointmentData.selectedDate);
                  return isNaN(parsedDate.getTime())
                    ? "Data non disponibile"
                    : formatDate(parsedDate);
                } else if (appointmentData.selectedDate?.toDate) {
                  return formatDate(appointmentData.selectedDate.toDate());
                } else if (appointmentData.selectedDate?.seconds) {
                  return formatDate(
                    new Date(appointmentData.selectedDate.seconds * 1000),
                  );
                } else {
                  return "Data non disponibile";
                }
              } catch (error) {
                console.error("Error formatting date for email:", error);
                return "Data non disponibile";
              }
            })(),
            appointmentType: appointmentData.appointmentType,
          };

          const response = await fetch("/api/send", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(emailData),
          });

          if (!response.ok) {
            console.warn(
              "Failed to send confirmation email:",
              response.statusText,
            );
          } else {
            console.log("✅ Confirmation email sent successfully");
          }
        } catch (emailError) {
          console.warn("Email sending failed:", emailError);
          // Don't fail the appointment creation if email fails
        }
      }

      setIsAddModalOpen(false);
      resetForm();
    } catch (error) {
      console.error("Error saving appointment:", error);
    }
  };

  // Chain Appointment Handler
  const handleChainAppointment = async () => {
    try {
      if (!validateForm()) {
        showError("Compila tutti i campi obbligatori prima di concatenare.");
        return;
      }

      const appointmentDate = createAppointmentDate(formData.selectedDate);
      if (!appointmentDate) {
        throw new Error("Invalid date selected");
      }

      const appointmentData = {
        name: formData.name.trim(),
        email: formData.email.trim(),
        number: formData.number,
        appointmentType: formData.appointmentType,
        startTime: formData.startTime,
        duration: parseInt(formData.duration),
        selectedDate: appointmentDate,
        note: formData.note?.trim() || "",
        status: "confirmed",
      };

      // Calculate end time WITHOUT extra time for chaining
      appointmentData.endTime = calculateEndTime(
        formData.startTime,
        appointmentData.duration,
      );
      appointmentData.totalDuration = appointmentData.duration;

      await notifyAsync(() => createAppointment(appointmentData), {
        loading: "Creazione appuntamento...",
        success: "Appuntamento creato! Pronto per il prossimo.",
        error: "Impossibile creare l'appuntamento",
      });

      // Prepare form for next appointment: set startTime to previous endTime, clear client info
      setFormData((prev) => ({
        ...prev,
        name: "",
        email: "",
        number: "",
        note: "",
        startTime: appointmentData.endTime,
        // Keep same date, appointmentType, duration
      }));
      setFormErrors({});
      setTimeout(() => {
        const nameInput = document.getElementById("name");
        if (nameInput) nameInput.focus();
      }, 100);
    } catch (error) {
      console.error("Error chaining appointment:", error);
    }
  };

  const handleDeleteAppointment = async (appointment) => {
    const confirmDelete = await showConfirmation({
      title: "Elimina appuntamento",
      message: `Vuoi eliminare definitivamente l'appuntamento di ${appointment.name}?\n\nQuesta azione non puo' essere annullata.`,
      confirmText: "Si, elimina",
      cancelText: "No, mantieni",
      type: "warning",
      allowClose: false,
    });

    if (confirmDelete === "confirm") {
      // Second confirmation for permanent deletion
      const finalConfirm = await showConfirmation({
        title: "Conferma eliminazione definitiva",
        message: `Sei sicuro di voler eliminare definitivamente l'appuntamento di ${appointment.name}?\n\nQuesto comportera':\n• Rimozione dell'appuntamento dal database\n• Invio di una notifica di cancellazione al cliente\n• Azione irreversibile`,
        confirmText: "Si, elimina definitivamente",
        cancelText: "No, annulla",
        type: "error",
        allowClose: false,
      });

      if (finalConfirm === "confirm") {
        try {
          await notifyAsync(
            async () => {
              await deleteAppointment(appointment.id);

              // Skip cancellation email when there's no recipient (e.g. manual time blocks)
              if (!appointment.email?.trim()) {
                return;
              }

              // Send cancellation email
              const emailData = {
                email: appointment.email,
                name: appointment.name,
                startTime: appointment.startTime,
                endTime: appointment.endTime,
                duration: appointment.duration,
                date: (() => {
                  try {
                    const appointmentDate =
                      appointment.selectedDate || appointment.date;
                    if (appointmentDate instanceof Date) {
                      return formatDate(appointmentDate);
                    } else if (typeof appointmentDate === "string") {
                      const parsedDate = new Date(appointmentDate);
                      return isNaN(parsedDate.getTime())
                        ? "Data non disponibile"
                        : formatDate(parsedDate);
                    } else if (appointmentDate?.toDate) {
                      return formatDate(appointmentDate.toDate());
                    } else if (appointmentDate?.seconds) {
                      return formatDate(
                        new Date(appointmentDate.seconds * 1000),
                      );
                    } else {
                      return "Data non disponibile";
                    }
                  } catch (error) {
                    console.error("Error formatting date for email:", error);
                    return "Data non disponibile";
                  }
                })(),
              };

              const response = await fetch("/api/cancel", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(emailData),
              });

              if (!response.ok) {
                throw new Error("Impossibile inviare l'email di cancellazione");
              }
            },
            {
              loading: "Eliminazione appuntamento...",
              success: "Appuntamento eliminato con successo!",
              error: "Impossibile eliminare l'appuntamento",
            },
          );
        } catch (error) {
          console.error("Error deleting appointment:", error);
        }
      }
      // If finalConfirm === "cancel" or "close", do nothing (user cancelled deletion)
    }
    // If confirmDelete === "cancel" or "close", do nothing (user cancelled deletion)
  };

  // Handle modal close with cleanup
  const handleCloseModal = () => {
    setIsAddModalOpen(false);
    setIsEditMode(false);
    setSelectedAppointment(null);
    resetForm();
    setFormErrors({});
  };

  // ============================================================================
  // CALENDAR HANDLERS
  // ============================================================================

  // Handle month navigation in calendar - load appointments for the new month
  const handleMonthChange = async (newMonth) => {
    try {
      console.log(
        "📅 Calendar month changed to:",
        newMonth.toISOString().split("T")[0],
      );

      // Get the start and end of the new month
      const startOfMonth = new Date(
        newMonth.getFullYear(),
        newMonth.getMonth(),
        1,
      );
      const endOfMonth = new Date(
        newMonth.getFullYear(),
        newMonth.getMonth() + 1,
        0,
      );
      endOfMonth.setHours(23, 59, 59, 999);

      console.log("📅 Loading appointments for month range:", {
        start: startOfMonth.toISOString().split("T")[0],
        end: endOfMonth.toISOString().split("T")[0],
      });

      // Load appointments for the new month
      await fetchAppointments({
        dateRange: {
          start: startOfMonth.toISOString(),
          end: endOfMonth.toISOString(),
        },
      });

      console.log("✅ Month navigation completed successfully");
    } catch (error) {
      console.error("❌ Error loading appointments for new month:", error);
      showError("Impossibile caricare gli appuntamenti del mese selezionato");
    }
  };

  // ============================================================================
  // DATA INITIALIZATION
  // ============================================================================

  // Fetch total count and appointments efficiently on mount
  useEffect(() => {
    const initializeDashboard = async () => {
      if (hasInitializedRef.current) {
        console.log("📊 Dashboard: Already initialized, skipping...");
        return;
      }

      try {
        hasInitializedRef.current = true;
        console.log("📊 Dashboard: Initializing dashboard...");

        // Clean up past appointment data to optimize memory for future-only approach
        const { cleanupPastAppointmentData } =
          await import("@/lib/cache/appointmentCache");
        cleanupPastAppointmentData();

        // Just get the total count if needed
        const { dataManager } = await import("@/lib/firebase/dataManager");
        const { getCachedTotalCount } =
          await import("@/lib/cache/appointmentCache");

        const cachedTotalCount = getCachedTotalCount();

        if (!cachedTotalCount) {
          console.log("📡 Fetching total count from database...");
          setLoadingTotalCount(true);
          const totalCount = await dataManager.getTotalAppointmentCount();
          setTotalDatabaseCount(totalCount);
          setLoadingTotalCount(false);
        } else {
          console.log("✅ Using cached total count:", cachedTotalCount);
          setTotalDatabaseCount(cachedTotalCount);
          setLoadingTotalCount(false);
        }

        console.log("✅ Dashboard initialization completed");
      } catch (error) {
        console.error("❌ Dashboard: Error during initialization:", error);
        hasInitializedRef.current = false; // Reset on error so we can retry
        setLoadingTotalCount(false);
      }
    };

    // Only initialize if we have a user (prevent initialization during auth loading)
    if (user && !authLoading) {
      initializeDashboard();
    }

    // Cleanup function for React StrictMode
    return () => {
      // In development with StrictMode, this prevents the effect from running twice
      // The ref persists across unmount/remount cycles
    };
  }, [user, authLoading]); // Add user and authLoading as dependencies

  // ============================================================================
  // RENDER HELPERS
  // ============================================================================

  const getStatusBadge = (status) => {
    const color = APPOINTMENT_STATUS_COLORS[status] || "#6b7280";
    const label = APPOINTMENT_STATUS_LABELS[status] || status;

    return (
      <span
        className="inline-flex items-center px-2 py-1 text-xs font-medium rounded-full"
        style={{
          backgroundColor: `${color}20`,
          color: color,
          border: `1px solid ${color}40`,
        }}
      >
        {label}
      </span>
    );
  };

  // ✅ Conditional rendering AFTER all hooks are called
  // Show loading while checking auth
  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-gray-900 dark:border-gray-100"></div>
          <p className="mt-4 text-gray-600 dark:text-gray-300">
            Verifica autenticazione...
          </p>
        </div>
      </div>
    );
  }

  // Show redirect message if no user (will redirect to login)
  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-gray-600 dark:text-gray-300">
            Reindirizzamento al login...
          </p>
        </div>
      </div>
    );
  }

  // ✅ Main dashboard content (only when authenticated)
  return (
    <div className="relative min-h-screen overflow-x-hidden bg-[#f4f6fa] p-4 dark:bg-zinc-950 md:p-6">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -left-16 top-20 h-72 w-72 rounded-full bg-sky-300/20 blur-3xl dark:bg-sky-500/10" />
        <div className="absolute right-0 top-0 h-80 w-80 rounded-full bg-indigo-300/15 blur-3xl dark:bg-indigo-500/10" />
      </div>

      <div className="relative mx-auto flex w-full max-w-[1680px] flex-col gap-4">
        {/* Top bar with break, newsletter, and dark mode toggle */}
        <div className="z-30 grid gap-3 rounded-xl border border-zinc-200/80 bg-white/90 px-3 py-3 shadow-sm backdrop-blur-sm dark:border-zinc-700/70 dark:bg-zinc-900/75 md:grid-cols-[1fr_auto] md:items-center md:px-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-zinc-100 px-3 py-1 text-xs font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">
              Dashboard Operativo
            </span>
            <span className="rounded-full border border-zinc-200 px-3 py-1 text-xs text-zinc-600 dark:border-zinc-700 dark:text-zinc-300">
              Data: {formatDate(selectedDate)}
            </span>
            <span className="rounded-full border border-zinc-200 px-3 py-1 text-xs text-zinc-600 dark:border-zinc-700 dark:text-zinc-300">
              Oggi: {filteredAppointments.length}
            </span>
            <span className="rounded-full border border-zinc-200 px-3 py-1 text-xs text-zinc-600 dark:border-zinc-700 dark:text-zinc-300">
              Caricati: {appointments.length}
            </span>
            <span className="rounded-full border border-zinc-200 px-3 py-1 text-xs text-zinc-600 dark:border-zinc-700 dark:text-zinc-300">
              Totale DB:{" "}
              {loadingTotalCount
                ? "..."
                : (totalDatabaseCount ?? appointments.length)}
            </span>
          </div>

          <div className="flex items-center justify-end gap-2">
            <Button
              onClick={() => setIsVacationModalOpen(true)}
              className="hidden items-center gap-2 sm:flex"
            >
              <Plus className="h-4 w-4" />
              Imposta pausa
            </Button>
            <Button
              variant="secondary"
              onClick={() => setIsSubscriberModalOpen(true)}
              className="hidden items-center gap-2 dark:bg-gray-600 sm:flex"
            >
              <Mail className="h-4 w-4" />
              Iscritti newsletter
            </Button>
            <Button
              asChild
              variant="secondary"
              className="hidden items-center gap-2 dark:bg-gray-600 sm:flex"
            >
              <Link href="/export">
                <Database className="h-4 w-4" />
                Esporta dati
              </Link>
            </Button>
            <div className="ml-2 flex items-center gap-2">
              <span className="text-xs text-zinc-600 dark:text-zinc-300">
                Modalita scura
              </span>
              <button
                onClick={() => toggleDarkMode()}
                className={`flex h-6 w-12 items-center rounded-full p-1 transition-colors duration-300 ${
                  darkMode ? "bg-zinc-700" : "bg-zinc-300"
                }`}
                aria-label="Attiva o disattiva modalita scura"
              >
                <span
                  className={`h-4 w-4 transform rounded-full bg-white shadow transition-transform duration-300 dark:bg-zinc-200 ${
                    darkMode ? "translate-x-6" : "translate-x-0"
                  }`}
                />
              </button>
            </div>
          </div>
        </div>

        {/* Newsletter Subscriber List Dialog */}
        <Dialog
          open={isSubscriberModalOpen}
          onOpenChange={setIsSubscriberModalOpen}
        >
          <DialogContent className="max-w-lg w-full p-0 dark:border-none dark:bg-zinc-900">
            <div className="p-4">
              <DialogHeader>
                <DialogTitle>Iscrizioni newsletter</DialogTitle>
              </DialogHeader>
              <SubscriberList onClose={() => setIsSubscriberModalOpen(false)} />
            </div>
          </DialogContent>
        </Dialog>

        <div className="min-h-0">
          {/* Main Content Card with Overflow Fixes */}
          <Card className="z-20 mt-1 w-full border border-zinc-200 bg-white/95 shadow-lg shadow-zinc-900/5 dark:border-zinc-700/60 dark:bg-zinc-900/90">
            <CardHeader className="flex flex-col gap-2 border-b border-zinc-200 bg-zinc-50/90 p-4 dark:border-zinc-700/60 dark:bg-zinc-900/80 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex flex-col gap-1">
                <h1 className="text-xl font-bold text-zinc-800 dark:text-zinc-100">
                  Dashboard
                </h1>
                <span className="text-sm font-normal text-zinc-500 dark:text-zinc-400">
                  {formatDate(selectedDate)}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  onClick={handleOpenBlockModal}
                  variant="outline"
                  className="flex items-center gap-2 border-zinc-300 bg-white/80 hover:bg-zinc-100 dark:border-zinc-600 dark:bg-zinc-800/80 dark:hover:bg-zinc-700"
                >
                  <Clock3 className="h-4 w-4" />
                  Blocco rapido
                </Button>
                <Button
                  onClick={handleAddAppointment}
                  className="flex items-center gap-2"
                >
                  <Plus className="h-4 w-4" />
                  Nuovo appuntamento
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-4 md:p-6">
              {/* Calendar and Appointments - Responsive Layout */}
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-[360px_minmax(0,1fr)]">
                {/* Calendar */}
                <div className="rounded-xl border border-zinc-200 bg-zinc-50/70 p-3 dark:border-zinc-700 dark:bg-zinc-900/70 md:p-4">
                  <AppointmentCalendar
                    selectedDate={selectedDate}
                    onDateChange={setSelectedDate}
                    appointments={appointments}
                    onMonthChange={handleMonthChange}
                  />
                </div>

                {/* Appointments Table */}
                <div className="min-w-0 flex flex-col">
                  {/* Responsive Table: Card/List view on mobile, Table on desktop */}
                  <div className="block sm:hidden space-y-3">
                    {filteredAppointments.length === 0 ? (
                      <div className="text-center py-8 text-zinc-400 dark:text-zinc-500">
                        Nessun appuntamento per questa data.
                      </div>
                    ) : (
                      filteredAppointments.map((appointment) => (
                        <div
                          key={appointment.id}
                          className="rounded-lg border border-zinc-200 bg-white p-3 shadow-sm dark:border-zinc-700 dark:bg-zinc-800"
                        >
                          <div className="space-y-1">
                            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500 dark:text-zinc-400">
                              {appointment.appointmentType}
                            </p>
                            <p className="max-w-[230px] break-words text-base font-semibold leading-tight text-zinc-900 dark:text-zinc-100">
                              {appointment.name}
                            </p>
                            <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                              {appointment.startTime} - {appointment.endTime}
                            </p>
                          </div>
                          {appointment.email && (
                            <div className="text-xs text-zinc-500 dark:text-zinc-400">
                              {appointment.email}
                            </div>
                          )}
                          {appointment.note && (
                            <div className="mt-1 text-xs leading-[1.25] text-zinc-600 dark:text-zinc-400">
                              <span className="font-semibold">
                                Note:
                              </span>{" "}
                              {appointment.note}
                            </div>
                          )}
                          <div className="flex gap-2 mt-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleEditAppointment(appointment)}
                              className="flex-1 bg-white hover:bg-gray-100 border border-zinc-200 dark:border-none dark:bg-gray-600 dark:hover:bg-gray-700"
                            >
                              <Edit className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() =>
                                handleDeleteAppointment(appointment)
                              }
                              className="flex-1 bg-white hover:bg-red-50 border border-zinc-200 dark:border-none dark:bg-red-600 dark:hover:bg-red-700 text-red-600 dark:text-white"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                  <div className="hidden max-h-[68vh] min-h-[420px] overflow-y-auto rounded-lg border border-zinc-200 bg-white/60 sm:block dark:border-zinc-700 dark:bg-zinc-900/30">
                    <Card className="border-0 bg-transparent shadow-none dark:bg-transparent">
                      <CardContent className="p-0">
                        <div className="overflow-x-auto">
                          <Table className="min-w-full text-sm">
                            <TableHeader>
                              <TableRow>
                                <TableHead className="w-[200px] dark:text-zinc-300">
                                  Servizio
                                </TableHead>
                                <TableHead className="dark:text-zinc-300">
                                  Inizio
                                </TableHead>
                                <TableHead className="dark:text-zinc-300">
                                  Fine
                                </TableHead>
                                <TableHead className="w-[200px] dark:text-zinc-300">
                                  Cliente
                                </TableHead>
                                <TableHead className="dark:text-zinc-300">
                                  Note
                                </TableHead>
                                <TableHead className="dark:text-zinc-300">
                                  Azioni
                                </TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {filteredAppointments.length === 0 ? (
                                <TableRow>
                                  <TableCell
                                    colSpan={6}
                                    className="text-center py-8 text-zinc-400 dark:text-zinc-500"
                                  >
                                    Nessun appuntamento per questa data.
                                  </TableCell>
                                </TableRow>
                              ) : (
                                filteredAppointments.map((appointment) => (
                                  <TableRow
                                    key={appointment.id}
                                    className="hover:bg-zinc-50 dark:hover:bg-zinc-800 transition"
                                  >
                                    <TableCell className="w-[170px] align-top dark:text-zinc-200">
                                      <div className="max-w-[170px] break-words whitespace-normal leading-[1.15]">
                                        {appointment.appointmentType}
                                      </div>
                                    </TableCell>
                                    <TableCell className="dark:text-zinc-200">
                                      {appointment.startTime}
                                    </TableCell>
                                    <TableCell className="dark:text-zinc-200">
                                      {appointment.endTime}
                                    </TableCell>
                                    <TableCell className="dark:text-zinc-200">
                                      <div className="font-medium">
                                        {appointment.name}
                                      </div>
                                      <div className="text-zinc-500 dark:text-zinc-400 text-xs">
                                        {appointment.email}
                                      </div>
                                    </TableCell>
                                    <TableCell className="dark:text-zinc-200 max-w-32">
                                      <div
                                        className="max-w-32 break-words whitespace-normal text-xs leading-[1.2] text-zinc-600 dark:text-zinc-400"
                                        title={
                                          appointment.note || "Nessuna nota"
                                        }
                                      >
                                        {appointment.note || "-"}
                                      </div>
                                    </TableCell>
                                    <TableCell>
                                      <div className="flex gap-1">
                                        <Button
                                          variant="outline"
                                          size="sm"
                                          onClick={() =>
                                            handleEditAppointment(appointment)
                                          }
                                          className="bg-white hover:bg-gray-100 border border-zinc-200 dark:border-none dark:bg-gray-600 dark:hover:bg-gray-700"
                                        >
                                          <Edit className="h-3 w-3" />
                                        </Button>
                                        <Button
                                          variant="outline"
                                          size="sm"
                                          onClick={() =>
                                            handleDeleteAppointment(appointment)
                                          }
                                          className="bg-white hover:bg-red-50 border border-zinc-200 dark:border-none dark:bg-red-600 dark:hover:bg-red-700 text-red-600 dark:text-white"
                                        >
                                          <Trash2 className="h-3 w-3" />
                                        </Button>
                                      </div>
                                    </TableCell>
                                  </TableRow>
                                ))
                              )}
                            </TableBody>
                          </Table>
                        </div>
                      </CardContent>
                    </Card>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Quick Time Block Modal */}
        <Dialog
          open={isBlockModalOpen}
          onOpenChange={(open) => {
            if (!open) {
              setIsBlockModalOpen(false);
              resetBlockForm();
            } else {
              setIsBlockModalOpen(true);
            }
          }}
        >
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Aggiungi blocco orario</DialogTitle>
              <DialogDescription>
                Blocca velocemente una fascia oraria per impedire prenotazioni
                online in quel periodo.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-2">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="blockDate">Data *</Label>
                  <Input
                    id="blockDate"
                    type="date"
                    value={blockFormData.selectedDate}
                    onChange={(e) =>
                      handleBlockInputChange("selectedDate", e.target.value)
                    }
                    className={
                      blockFormErrors.selectedDate ? "border-red-500" : ""
                    }
                  />
                  {blockFormErrors.selectedDate && (
                    <p className="mt-1 text-xs text-red-500">
                      {blockFormErrors.selectedDate}
                    </p>
                  )}
                </div>

                <div>
                  <Label htmlFor="blockStartTime">Orario inizio *</Label>
                  <Input
                    id="blockStartTime"
                    type="time"
                    value={blockFormData.startTime}
                    onChange={(e) =>
                      handleBlockInputChange("startTime", e.target.value)
                    }
                    className={
                      blockFormErrors.startTime ? "border-red-500" : ""
                    }
                  />
                  {blockFormErrors.startTime && (
                    <p className="mt-1 text-xs text-red-500">
                      {blockFormErrors.startTime}
                    </p>
                  )}
                </div>
              </div>

              <div>
                <Label htmlFor="blockDuration">Durata (minuti) *</Label>
                <Input
                  id="blockDuration"
                  type="number"
                  min="5"
                  max="480"
                  step="5"
                  value={blockFormData.duration}
                  onChange={(e) =>
                    handleBlockInputChange("duration", e.target.value)
                  }
                  placeholder="Es: 120"
                  className={blockFormErrors.duration ? "border-red-500" : ""}
                />
                {blockFormErrors.duration && (
                  <p className="mt-1 text-xs text-red-500">
                    {blockFormErrors.duration}
                  </p>
                )}
                <div className="mt-2 flex flex-wrap gap-2">
                  {[30, 60, 90, 120].map((minutes) => (
                    <button
                      key={minutes}
                      type="button"
                      onClick={() =>
                        handleBlockInputChange("duration", String(minutes))
                      }
                      className="rounded-md border border-zinc-200 px-2 py-1 text-xs text-zinc-600 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                    >
                      {formatBlockPresetDuration(minutes)}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <Label htmlFor="blockNote">Nota (opzionale)</Label>
                <Input
                  id="blockNote"
                  value={blockFormData.note}
                  onChange={(e) =>
                    handleBlockInputChange("note", e.target.value)
                  }
                  placeholder="Es: visita medica / pausa lunga"
                />
              </div>
            </div>

            <DialogFooter className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setIsBlockModalOpen(false);
                  resetBlockForm();
                }}
              >
                Annulla
              </Button>
              <Button type="button" onClick={handleSaveTimeBlock}>
                Crea blocco
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Add/Edit Appointment Modal */}
        <Dialog
          open={isAddModalOpen}
          onOpenChange={(open) => {
            if (!open) {
              handleCloseModal();
            } else {
              setIsAddModalOpen(true);
            }
          }}
        >
          <DialogContent
            className="max-w-2xl max-h-[90vh] overflow-y-auto"
            onOpenAutoFocus={(e) => {
              // Prevent auto focus issues with Select components
              e.preventDefault();
              // Focus the first input instead
              setTimeout(() => {
                const nameInput = document.getElementById("name");
                if (nameInput) nameInput.focus();
              }, 100);
            }}
          >
            <DialogHeader>
              <DialogTitle>
                {isEditMode
                  ? "Modifica appuntamento"
                  : "Aggiungi nuovo appuntamento"}
              </DialogTitle>
              <DialogDescription>
                {isEditMode
                  ? "Modifica i dettagli dell'appuntamento qui sotto."
                  : "Compila i dettagli per creare un nuovo appuntamento."}
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-6 py-4">
              {/* Client Information Section */}
              <div className="space-y-4">
                <div className="flex items-center gap-2 pb-2 border-b border-gray-200 dark:border-gray-600">
                  <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                    Informazioni cliente
                  </h3>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="name">Nome *</Label>
                    <Input
                      id="name"
                      value={formData.name}
                      onChange={(e) =>
                        handleInputChange("name", e.target.value)
                      }
                      placeholder="Nome cliente"
                      className={`h-10 text-sm ${
                        formErrors.name
                          ? "border-red-500 focus:border-red-500"
                          : "border-gray-300 focus:border-blue-500 focus:ring-blue-500/20"
                      } dark:border-gray-600 dark:bg-gray-700 dark:text-white`}
                    />
                    {formErrors.name && (
                      <p className="text-sm text-red-500 mt-1">
                        {formErrors.name}
                      </p>
                    )}
                  </div>
                  <div>
                    <Label htmlFor="email">Email</Label>
                    <Input
                      id="email"
                      type="email"
                      value={formData.email}
                      onChange={(e) =>
                        handleInputChange("email", e.target.value)
                      }
                      placeholder="cliente@example.com (opzionale)"
                      className={`h-10 text-sm ${
                        formErrors.email
                          ? "border-red-500 focus:border-red-500"
                          : "border-gray-300 focus:border-blue-500 focus:ring-blue-500/20"
                      } dark:border-gray-600 dark:bg-gray-700 dark:text-white`}
                    />
                    {formErrors.email && (
                      <p className="text-sm text-red-500 mt-1">
                        {formErrors.email}
                      </p>
                    )}
                  </div>
                </div>

                <div>
                  <Label htmlFor="phone">Numero di telefono</Label>
                  <PhoneInput
                    country="it"
                    value={formData.number}
                    onChange={(value) => handleInputChange("number", value)}
                    inputStyle={{
                      width: "100%",
                      height: "2.5rem",
                      borderRadius: "0.375rem",
                      border: "1px solid #d1d5db",
                      fontSize: "0.875rem",
                      paddingLeft: "48px",
                    }}
                    containerStyle={{
                      width: "100%",
                    }}
                    buttonStyle={{
                      height: "2.5rem",
                      borderRadius: "0.375rem 0 0 0.375rem",
                      border: "1px solid #d1d5db",
                    }}
                  />
                </div>
              </div>

              {/* Service Details Section */}
              <div className="space-y-4">
                <div className="flex items-center gap-2 pb-2 border-b border-gray-200 dark:border-gray-600">
                  <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                    Dettagli servizio
                  </h3>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="appointmentType">Servizio *</Label>
                    {/* Use native select on mobile, custom Select on desktop */}
                    <div className="block sm:hidden">
                      <select
                        id="appointmentType"
                        value={formData.appointmentType}
                        onChange={(e) =>
                          handleAppointmentTypeChange(e.target.value)
                        }
                        className={`h-10 text-sm w-full rounded-md border focus:outline-none px-3 py-2
                        ${
                          formErrors.appointmentType
                            ? "border-red-500 focus:border-red-500"
                            : "border-gray-300 focus:border-blue-500 focus:ring-blue-500/20"
                        }
                        dark:border-gray-600 dark:bg-gray-700 dark:text-white`}
                        aria-label="Seleziona il tipo di servizio"
                        required
                      >
                        <option value="" disabled>
                          Seleziona servizio
                        </option>
                        {Object.values(APPOINTMENT_TYPES)
                          .filter((type) => type.active)
                          .map((type) => (
                            <option key={type.type} value={type.type}>
                              {type.type}
                            </option>
                          ))}
                      </select>
                    </div>
                    <div className="hidden sm:block">
                      <Select
                        value={formData.appointmentType}
                        onValueChange={handleAppointmentTypeChange}
                      >
                        <SelectTrigger
                          className={`h-10 text-sm ${
                            formErrors.appointmentType
                              ? "border-red-500 focus:border-red-500"
                              : "border-gray-300 focus:border-blue-500 focus:ring-blue-500/20"
                          } dark:border-gray-600 dark:bg-gray-700 dark:text-white`}
                          aria-label="Seleziona il tipo di servizio"
                        >
                          <SelectValue placeholder="Seleziona servizio" />
                        </SelectTrigger>
                        <SelectContent
                          className="max-h-60 overflow-y-auto bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-md shadow-lg z-50"
                          position="popper"
                          sideOffset={4}
                        >
                          {Object.values(APPOINTMENT_TYPES)
                            .filter((type) => type.active)
                            .map((type) => (
                              <SelectItem
                                key={type.type}
                                value={type.type}
                                className="px-3 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer transition-colors duration-150 focus:bg-gray-100 dark:focus:bg-gray-700"
                              >
                                {type.type}
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                    </div>
                    {formErrors.appointmentType && (
                      <p className="text-sm text-red-500 mt-1">
                        {formErrors.appointmentType}
                      </p>
                    )}
                  </div>
                  <div>
                    <Label htmlFor="duration">Durata (minuti) *</Label>
                    <Input
                      id="duration"
                      type="number"
                      min="5"
                      max="300"
                      step="5"
                      value={formData.duration}
                      onChange={(e) =>
                        handleInputChange("duration", e.target.value)
                      }
                      placeholder="es. 60"
                      className={`h-10 text-sm ${
                        formErrors.duration
                          ? "border-red-500 focus:border-red-500"
                          : "border-gray-300 focus:border-blue-500 focus:ring-blue-500/20"
                      } dark:border-gray-600 dark:bg-gray-700 dark:text-white`}
                    />
                    {formData.appointmentType && (
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                        Suggerita:{" "}
                        {getAppointmentType(
                          formData.appointmentType,
                        )?.durations?.join(", ") || "N/D"}{" "}
                        minuti
                      </p>
                    )}
                    {formErrors.duration && (
                      <p className="text-sm text-red-500 mt-1">
                        {formErrors.duration}
                      </p>
                    )}
                  </div>
                </div>
              </div>

              {/* Scheduling Section */}
              <div className="space-y-4">
                <div className="flex items-center gap-2 pb-2 border-b border-gray-200 dark:border-gray-600">
                  <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                    Pianificazione
                  </h3>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="startTime">Orario di inizio *</Label>
                    <Input
                      id="startTime"
                      type="time"
                      value={formData.startTime}
                      onChange={(e) =>
                        handleInputChange("startTime", e.target.value)
                      }
                      className={`h-10 text-sm ${
                        formErrors.startTime
                          ? "border-red-500 focus:border-red-500"
                          : "border-gray-300 focus:border-blue-500 focus:ring-blue-500/20"
                      } dark:border-gray-600 dark:bg-gray-700 dark:text-white`}
                    />
                    {formErrors.startTime && (
                      <p className="text-sm text-red-500 mt-1">
                        {formErrors.startTime}
                      </p>
                    )}
                  </div>
                  <div>
                    <Label htmlFor="selectedDate">Data *</Label>
                    <Input
                      id="selectedDate"
                      type="date"
                      value={formData.selectedDate}
                      onChange={(e) =>
                        handleInputChange("selectedDate", e.target.value)
                      }
                      className={`h-10 text-sm ${
                        formErrors.selectedDate
                          ? "border-red-500 focus:border-red-500"
                          : "border-gray-300 focus:border-blue-500 focus:ring-blue-500/20"
                      } dark:border-gray-600 dark:bg-gray-700 dark:text-white`}
                    />
                    {formErrors.selectedDate && (
                      <p className="text-sm text-red-500 mt-1">
                        {formErrors.selectedDate}
                      </p>
                    )}
                  </div>
                </div>
              </div>

              {/* Additional Information Section */}
              <div className="space-y-4">
                <div className="flex items-center gap-2 pb-2 border-b border-gray-200 dark:border-gray-600">
                  <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                    Informazioni aggiuntive
                  </h3>
                </div>

                <div>
                  <Label htmlFor="note">Note</Label>
                  <Input
                    id="note"
                    value={formData.note}
                    onChange={(e) => handleInputChange("note", e.target.value)}
                    placeholder="Note aggiuntive (opzionale)"
                    className="h-10 text-sm border-gray-300 focus:border-blue-500 focus:ring-blue-500/20 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                  />
                </div>
              </div>

              {/* Helper text for required fields */}
              <div className="text-center pt-2">
                <p className="text-sm text-muted-foreground">
                  I campi contrassegnati con * sono obbligatori
                </p>
              </div>
            </div>

            <DialogFooter className="flex gap-2 pt-4">
              <Button
                variant="outline"
                onClick={handleCloseModal}
                className="px-6 hover:bg-gray-100 dark:hover:bg-gray-700"
              >
                Annulla
              </Button>
              <Button
                onClick={handleSaveAppointment}
                disabled={appointmentsLoading}
                className="px-6"
              >
                {appointmentsLoading
                  ? "Salvataggio..."
                  : isEditMode
                    ? "Aggiorna appuntamento"
                    : "Crea appuntamento"}
              </Button>
              {!isEditMode && (
                <Button
                  variant="secondary"
                  onClick={handleChainAppointment}
                  disabled={appointmentsLoading}
                  className="px-6"
                  type="button"
                >
                  + Aggiungi subito dopo
                </Button>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Vacation Manager Modal */}
        <VacationManager
          isOpen={isVacationModalOpen}
          onClose={() => setIsVacationModalOpen(false)}
        />
      </div>
    </div>
  );
};

export default Dashy;
