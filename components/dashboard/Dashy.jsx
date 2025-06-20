"use client";
import React, { useState, useEffect, useMemo, useRef } from "react";
import { X, Plus, Edit, Mail, Phone, Database } from "lucide-react";
import PhoneInput from "react-phone-input-2";
import "react-phone-input-2/lib/style.css";

// UI Components
import { CardTitle, CardHeader, CardContent, Card } from "@/components/ui/card";
import {
  TableHead,
  TableRow,
  TableHeader,
  TableCell,
  TableBody,
  Table,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
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

// Import Link for navigation
import Link from "next/link";

// Context and Hooks
import { useAppointmentContext } from "@/context/AppointmentContext";
import { useNotification } from "@/context/NotificationContext";
import { useTheme } from "@/context/ThemeContext";

// Utilities
import {
  APPOINTMENT_TYPES,
  APPOINTMENT_STATUS_LABELS,
  APPOINTMENT_STATUS_COLORS,
  getAppointmentType,
} from "@/lib/utils/constants";
import {
  formatDate,
  formatTime,
  isToday,
  isSameDate,
  appointmentDateMatches,
  parseDate,
  formatDateString,
  createAppointmentDate,
  formatDateForInput,
  getTodayFormatted,
} from "@/lib/utils/dateUtils";
import { calculateEndTime } from "@/lib/utils/timeUtils";

// Separate Components
import AppointmentCalendar from "./AppointmentCalendar";
import VacationManager from "./VacationManager";
import SubscriberList from "../SubscriberList";
import { useOptimizedTimeSlots } from "@/hooks/useOptimizedTimeSlots";

const Dashy = ({ user, authLoading }) => {
  // ⚠️ ALL HOOKS MUST BE CALLED FIRST - Rules of Hooks
  // Local state for modals and forms
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [selectedAppointment, setSelectedAppointment] = useState(null);
  const [isVacationModalOpen, setIsVacationModalOpen] = useState(false);
  const [isSubscriberModalOpen, setIsSubscriberModalOpen] = useState(false);

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
          selectedDate
        );
        return matches;
      } catch (error) {
        console.error(
          "🔍 Dashboard: Error filtering appointment",
          appointment.id,
          error
        );
        return false;
      }
    });

    return filtered.sort((a, b) => a.startTime.localeCompare(b.startTime));
  }, [selectedDate, appointments]);

  // ============================================================================
  // DATA LOADING FUNCTIONS
  // ============================================================================

  // Function to get total database count on-demand
  const fetchTotalCount = async () => {
    try {
      setLoadingTotalCount(true);
      console.log("📊 Dashboard: Fetching total count on-demand...");
      
      const { dataManager } = await import("@/lib/firebase/dataManager");
      const totalCount = await dataManager.getTotalAppointmentCount();
      setTotalDatabaseCount(totalCount);
      
      console.log("📊 Dashboard: Total count fetched:", totalCount);
    } catch (error) {
      console.error("Error getting total count:", error);
      setTotalDatabaseCount(null);
      showError("Failed to get total appointment count");
    } finally {
      setLoadingTotalCount(false);
    }
  };

  // Smart extended data loading with cache optimization
  const loadExtendedData = async () => {
    setIsLoadingAllData(true);
    try {
      console.log("📊 Dashboard: Smart extended data loading...");

      // First, get total count if we don't have it
      if (totalDatabaseCount === null) {
        await fetchTotalCount();
      }

      // Load 6 months range efficiently (3 months back + 3 forward)
      const today = new Date();
      const threeMonthsAgo = new Date(today);
      threeMonthsAgo.setMonth(today.getMonth() - 3);
      const threeMonthsForward = new Date(today);
      threeMonthsForward.setMonth(today.getMonth() + 3);

      const extendedRange = {
        start: threeMonthsAgo.toISOString(),
        end: threeMonthsForward.toISOString(),
      };

      console.log("📊 Dashboard: Loading 6-month range with smart caching:", {
        start: threeMonthsAgo.toISOString().split("T")[0],
        end: threeMonthsForward.toISOString().split("T")[0],
        strategy: "cache-aware extended loading"
      });

      // Use cache-aware loading - should hit cache for many months
      await fetchAppointments({
        dateRange: extendedRange,
      });

      setShowingAllData(true);
      showSuccess(`Loaded 6-month range efficiently (using cache where possible).`);
      
    } catch (error) {
      console.error("Error in smart extended loading:", error);
      showError("Failed to load extended appointment data");
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
      errors.name = "Name is required";
    }

    // Email is now optional, but if provided, it should be valid
    if (
      formData.email?.trim() &&
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email.trim())
    ) {
      errors.email = "Please enter a valid email address";
    }

    if (!formData.appointmentType) {
      errors.appointmentType = "Service is required";
    }

    if (!formData.startTime) {
      errors.startTime = "Start time is required";
    }

    if (!formData.duration) {
      errors.duration = "Duration is required";
    } else {
      const durationNum = parseInt(formData.duration);
      if (isNaN(durationNum) || durationNum < 5) {
        errors.duration = "Duration must be at least 5 minutes";
      } else if (durationNum > 300) {
        errors.duration = "Duration cannot exceed 300 minutes (5 hours)";
      }
    }

    if (!formData.selectedDate) {
      errors.selectedDate = "Date is required";
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
      selectedDate: getTodayFormatted(),
    }));

    setIsAddModalOpen(true);
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
            appointmentDate
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
        "Warning: Could not parse appointment date, using today's date instead."
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
        if (formErrors.name) missingFields.push("Name");
        if (formErrors.appointmentType) missingFields.push("Service");
        if (formErrors.startTime) missingFields.push("Start Time");
        if (formErrors.duration) missingFields.push("Duration");
        if (formErrors.selectedDate) missingFields.push("Date");

        // Show error notification
        showError(
          `Please fill in all required fields: ${missingFields.join(", ")}`,
          { duration: 6000 }
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
        appointmentData.duration + extraTime
      );
      appointmentData.totalDuration = appointmentData.duration + extraTime;

      if (isEditMode && selectedAppointment) {
        await notifyAsync(
          () => updateAppointment(selectedAppointment.id, appointmentData),
          {
            loading: "Updating appointment...",
            success: "Appointment updated successfully!",
            error: "Failed to update appointment",
          }
        );
      } else {
        await notifyAsync(() => createAppointment(appointmentData), {
          loading: "Creating appointment...",
          success: "Appointment created successfully!",
          error: "Failed to create appointment",
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
                    ? "Unknown Date"
                    : formatDate(parsedDate);
                } else if (appointmentData.selectedDate?.toDate) {
                  return formatDate(appointmentData.selectedDate.toDate());
                } else if (appointmentData.selectedDate?.seconds) {
                  return formatDate(
                    new Date(appointmentData.selectedDate.seconds * 1000)
                  );
                } else {
                  return "Unknown Date";
                }
              } catch (error) {
                console.error("Error formatting date for email:", error);
                return "Unknown Date";
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
              response.statusText
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
        showError("Please fill in all required fields before chaining.");
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
        appointmentData.duration
      );
      appointmentData.totalDuration = appointmentData.duration;

      await notifyAsync(() => createAppointment(appointmentData), {
        loading: "Creating appointment...",
        success: "Appointment created! Ready for next.",
        error: "Failed to create appointment",
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
      title: "Delete Appointment",
      message: `Are you sure you want to permanently delete ${appointment.name}'s appointment?\n\nThis action cannot be undone.`,
      confirmText: "Yes, Delete",
      cancelText: "No, Keep It",
      type: "warning",
      allowClose: false,
    });

    if (confirmDelete === "confirm") {
      // Second confirmation for permanent deletion
      const finalConfirm = await showConfirmation({
        title: "Confirm Permanent Deletion",
        message: `Are you absolutely sure you want to permanently delete ${appointment.name}'s appointment?\n\nThis will:\n• Remove the appointment from the database\n• Send a cancellation notification to the client\n• This action cannot be undone`,
        confirmText: "Yes, Delete Permanently",
        cancelText: "No, Cancel",
        type: "error",
        allowClose: false,
      });

      if (finalConfirm === "confirm") {
        try {
          await notifyAsync(
            async () => {
              await deleteAppointment(appointment.id);

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
                        ? "Unknown Date"
                        : formatDate(parsedDate);
                    } else if (appointmentDate?.toDate) {
                      return formatDate(appointmentDate.toDate());
                    } else if (appointmentDate?.seconds) {
                      return formatDate(
                        new Date(appointmentDate.seconds * 1000)
                      );
                    } else {
                      return "Unknown Date";
                    }
                  } catch (error) {
                    console.error("Error formatting date for email:", error);
                    return "Unknown Date";
                  }
                })(),
              };

              const response = await fetch("/api/cancel", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(emailData),
              });

              if (!response.ok) {
                throw new Error("Failed to send cancellation email");
              }
            },
            {
              loading: "Deleting appointment and sending notification...",
              success: "Appointment deleted and notification sent!",
              error: "Failed to delete appointment",
            }
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

  // Handle month navigation with cache-first approach
  const handleMonthChange = async (newMonth) => {
    try {
      console.log(
        "📅 Calendar month changed to:",
        newMonth.toISOString().split("T")[0]
      );

      // Get the start and end of the new month
      const startOfMonth = new Date(
        newMonth.getFullYear(),
        newMonth.getMonth(),
        1
      );
      const endOfMonth = new Date(
        newMonth.getFullYear(),
        newMonth.getMonth() + 1,
        0
      );
      endOfMonth.setHours(23, 59, 59, 999);

      const monthRange = {
        start: startOfMonth.toISOString(),
        end: endOfMonth.toISOString(),
      };

      console.log("📅 Smart month loading for range:", {
        start: startOfMonth.toISOString().split("T")[0],
        end: endOfMonth.toISOString().split("T")[0],
        strategy: "cache-first with selective real-time"
      });

      // Use cache-first approach - the hook will handle caching and real-time updates
      // This should hit cache for historical months and enable real-time for current month
      await fetchAppointments({
        dateRange: monthRange,
      });

      console.log("✅ Smart month navigation completed - using cache + real-time strategy");
    } catch (error) {
      console.error("❌ Error in smart month loading:", error);
      showError("Failed to load appointments for the selected month");
    }
  };

  // ============================================================================
  // DATA INITIALIZATION
  // ============================================================================

  // Smart dashboard initialization with minimal database impact
  useEffect(() => {
    const initializeDashboard = async () => {
      if (hasInitializedRef.current) {
        console.log("📊 Dashboard: Already initialized, skipping...");
        return;
      }

      try {
        hasInitializedRef.current = true;
        console.log("📊 Dashboard: Smart initialization starting...");

        // Clean up past appointment data to optimize memory
        const { cleanupPastAppointmentData } = await import(
          "@/lib/cache/appointmentCache"
        );
        cleanupPastAppointmentData();

        // Skip total count query initially - it's expensive and not critical
        // The total count will be populated on-demand when "Show All Data" is clicked
        console.log("📊 Dashboard: Skipping total count query for faster startup");
        setLoadingTotalCount(false);
        setTotalDatabaseCount(null); // Will be fetched on-demand

        // The useOptimizedAppointments hook will handle:
        // 1. Loading current month data with caching
        // 2. Setting up real-time listeners for current month
        // 3. Using cached data for navigation to other months

        console.log("✅ Smart dashboard initialization completed (minimal DB impact)");
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
            Checking authentication...
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
            Redirecting to login...
          </p>
        </div>
      </div>
    );
  }

  // ✅ Main dashboard content (only when authenticated)
  return (
    <div className="w-full min-h-screen flex flex-col gap-4 bg-background dark:bg-zinc-900 p-4 overflow-x-hidden">
      {/* Top bar with break, newsletter, and dark mode toggle */}
      <div className="mb-2 flex gap-2 items-center justify-end bg-white/80 dark:bg-zinc-800/80 rounded-lg shadow-sm px-3 py-2 sm:px-4 sm:py-2 z-30 relative border border-zinc-200 dark:border-zinc-700/60">
        <div className="flex items-center gap-2 ml-auto">
          <Button
            onClick={() => setIsVacationModalOpen(true)}
            className="flex items-center gap-2 hidden sm:flex"
          >
            <Plus className="h-4 w-4" />
            Imposta break
          </Button>
          <Button
            variant="secondary"
            onClick={() => setIsSubscriberModalOpen(true)}
            className="flex items-center gap-2 dark:bg-gray-600 hidden sm:flex"
          >
            <Mail className="h-4 w-4" />
            Iscritti newsletter
          </Button>
          <Button
            asChild
            variant="secondary"
            className="flex items-center gap-2 dark:bg-gray-600 hidden sm:flex"
          >
            <Link href="/export">
              <Database className="h-4 w-4" />
              Esporta dati
            </Link>
          </Button>
          {/* Dark mode toggle */}
          <div className="flex items-center gap-2 ml-2">
            <span className="text-xs text-zinc-600 dark:text-zinc-300">
              Dark mode
            </span>
            <button
              onClick={() => toggleDarkMode()}
              className={`w-12 h-6 flex items-center rounded-full p-1 transition-colors duration-300 ${
                darkMode ? "bg-zinc-700" : "bg-zinc-300"
              }`}
              aria-label="Toggle dark mode"
            >
              <span
                className={`w-4 h-4 bg-white dark:bg-zinc-200 rounded-full shadow transform transition-transform duration-300 ${
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

      <div className="flex flex-col lg:flex-row gap-4 min-h-0">
        {/* Main Content Card with Overflow Fixes */}
        <Card className="bg-white dark:bg-zinc-800 rounded-lg lg:overflow-x-auto overflow-y-visible border border-zinc-200 dark:border-zinc-700/60 mt-4 lg:mt-0 z-20">
          <CardHeader className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between bg-zinc-50 dark:bg-zinc-900/80 border-b border-zinc-200 dark:border-zinc-700/60 p-4">
            <div className="flex flex-col gap-1">
              <h1 className="text-xl font-bold text-zinc-800 dark:text-zinc-100">
                Dashboard
              </h1>
              <span className="text-s text-zinc-500 dark:text-zinc-400 font-normal">
                {formatDate(selectedDate)}
              </span>
            </div>
            <Button
              onClick={handleAddAppointment}
              className="flex items-center gap-2"
            >
              <Plus className="h-4 w-4" />
              Nuovo appuntamento
            </Button>
          </CardHeader>
          <CardContent className="flex-1 overflow-y-auto p-4">
            {/* Calendar and Appointments - Responsive Layout */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Calendar */}
              <div className="lg:col-span-1">
                <AppointmentCalendar
                  selectedDate={selectedDate}
                  onDateChange={setSelectedDate}
                  appointments={appointments}
                  onMonthChange={handleMonthChange}
                />
              </div>

              {/* Appointments Table */}
              <div className="lg:col-span-2 flex flex-col min-h-0">
                {/* Responsive Table: Card/List view on mobile, Table on desktop */}
                <div className="block sm:hidden space-y-3">
                  {filteredAppointments.length === 0 ? (
                    <div className="text-center py-8 text-zinc-400 dark:text-zinc-500">
                      No appointments for this date.
                    </div>
                  ) : (
                    filteredAppointments.map((appointment) => (
                      <div
                        key={appointment.id}
                        className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 p-3 flex flex-col gap-1 shadow-sm"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-zinc-900 dark:text-zinc-100 text-base">
                            {appointment.appointmentType}
                          </span>
                        </div>
                        <div className="text-m text-zinc-500 dark:text-zinc-400">
                          {appointment.startTime} - {appointment.endTime}
                        </div>
                        <div className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
                          {appointment.name}
                        </div>
                        {appointment.email && (
                          <div className="text-xs text-zinc-500 dark:text-zinc-400">
                            {appointment.email}
                          </div>
                        )}
                        {appointment.note && (
                          <div className="text-xs text-zinc-600 dark:text-zinc-400 mt-1">
                            <span className="font-semibold">Note:</span>{" "}
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
                            onClick={() => handleDeleteAppointment(appointment)}
                            className="flex-1 bg-white hover:bg-red-50 border border-zinc-200 dark:border-none dark:bg-red-600 dark:hover:bg-red-700 text-red-600 dark:text-white"
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
                <div className="hidden sm:block h-[70vh] overflow-y-auto rounded-lg">
                  <Card className="dark:bg-zinc-700/50">
                    <CardContent className="p-0">
                      <div className="overflow-x-auto">
                        <Table className="min-w-full text-sm">
                          <TableHeader>
                            <TableRow>
                              <TableHead className="dark:text-zinc-300">
                                Type
                              </TableHead>
                              <TableHead className="dark:text-zinc-300">
                                Start
                              </TableHead>
                              <TableHead className="dark:text-zinc-300">
                                End
                              </TableHead>
                              <TableHead className="dark:text-zinc-300">
                                Client
                              </TableHead>
                              <TableHead className="dark:text-zinc-300">
                                Notes
                              </TableHead>
                              <TableHead className="dark:text-zinc-300">
                                Actions
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
                                  No appointments for this date.
                                </TableCell>
                              </TableRow>
                            ) : (
                              filteredAppointments.map((appointment) => (
                                <TableRow
                                  key={appointment.id}
                                  className="hover:bg-zinc-50 dark:hover:bg-zinc-800 transition"
                                >
                                  <TableCell className="dark:text-zinc-200">
                                    {appointment.appointmentType}
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
                                      className="text-xs text-zinc-600 dark:text-zinc-400 truncate"
                                      title={appointment.note || "No notes"}
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
                                        <X className="h-3 w-3" />
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
              {isEditMode ? "Edit Appointment" : "Add New Appointment"}
            </DialogTitle>
            <DialogDescription>
              {isEditMode
                ? "Make changes to the appointment details below."
                : "Fill in the details to create a new appointment."}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-6 py-4">
            {/* Client Information Section */}
            <div className="space-y-4">
              <div className="flex items-center gap-2 pb-2 border-b border-gray-200 dark:border-gray-600">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                  Client Information
                </h3>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="name">Name *</Label>
                  <Input
                    id="name"
                    value={formData.name}
                    onChange={(e) => handleInputChange("name", e.target.value)}
                    placeholder="Client name"
                    className={`min-h-[2.5rem] h-auto text-sm ${
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
                    onChange={(e) => handleInputChange("email", e.target.value)}
                    placeholder="client@example.com (optional)"
                    className={`min-h-[2.5rem] h-auto text-sm ${
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
                <Label htmlFor="phone">Phone Number</Label>
                <div className="phone-input-container">
                  <PhoneInput
                    country="it"
                    value={formData.number}
                    onChange={(value) => handleInputChange("number", value)}
                    inputClass="phone-input-field"
                    buttonClass="phone-input-button"
                    containerClass="phone-input-wrapper"
                  />
                </div>
                <style jsx>{`
                  .phone-input-container :global(.phone-input-wrapper) {
                    width: 100%;
                  }
                  .phone-input-container :global(.phone-input-field) {
                    width: 100% !important;
                    min-height: 2.5rem !important;
                    height: auto !important;
                    border-radius: 0.375rem !important;
                    border: 1px solid hsl(var(--border)) !important;
                    font-size: 0.875rem !important;
                    padding-left: 3rem !important;
                    line-height: 1.5 !important;
                  }
                  .phone-input-container :global(.phone-input-button) {
                    min-height: 2.5rem !important;
                    height: auto !important;
                    border-radius: 0.375rem 0 0 0.375rem !important;
                    border: 1px solid hsl(var(--border)) !important;
                    display: flex !important;
                    align-items: center !important;
                  }
                  @media (min-width: 1024px) {
                    .phone-input-container :global(.phone-input-field) {
                      font-size: 1rem !important;
                      min-height: 2.75rem !important;
                    }
                    .phone-input-container :global(.phone-input-button) {
                      min-height: 2.75rem !important;
                    }
                  }
                `}</style>
              </div>
            </div>

            {/* Service Details Section */}
            <div className="space-y-4">
              <div className="flex items-center gap-2 pb-2 border-b border-gray-200 dark:border-gray-600">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                  Service Details
                </h3>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="appointmentType">Service *</Label>
                  {/* Use native select on mobile, custom Select on desktop */}
                  <div className="block sm:hidden">
                    <select
                      id="appointmentType"
                      value={formData.appointmentType}
                      onChange={(e) =>
                        handleAppointmentTypeChange(e.target.value)
                      }
                      className={`min-h-[2.5rem] h-auto text-sm w-full rounded-md border focus:outline-none px-3 py-2
                        ${
                          formErrors.appointmentType
                            ? "border-red-500 focus:border-red-500"
                            : "border-gray-300 focus:border-blue-500 focus:ring-blue-500/20"
                        }
                        dark:border-gray-600 dark:bg-gray-700 dark:text-white`}
                      aria-label="Select service type"
                      required
                    >
                      <option value="" disabled>
                        Select service
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
                        className={`min-h-[2.5rem] h-auto text-sm ${
                          formErrors.appointmentType
                            ? "border-red-500 focus:border-red-500"
                            : "border-gray-300 focus:border-blue-500 focus:ring-blue-500/20"
                        } dark:border-gray-600 dark:bg-gray-700 dark:text-white`}
                        aria-label="Select service type"
                      >
                        <SelectValue placeholder="Select service" />
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
                  <Label htmlFor="duration">Duration (minutes) *</Label>
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
                    placeholder="e.g. 60"
                    className={`min-h-[2.5rem] h-auto text-sm ${
                      formErrors.duration
                        ? "border-red-500 focus:border-red-500"
                        : "border-gray-300 focus:border-blue-500 focus:ring-blue-500/20"
                    } dark:border-gray-600 dark:bg-gray-700 dark:text-white`}
                  />
                  {formData.appointmentType && (
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                      Suggested:{" "}
                      {getAppointmentType(
                        formData.appointmentType
                      )?.durations?.join(", ") || "N/A"}{" "}
                      minutes
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
                  Scheduling
                </h3>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="startTime">Start Time *</Label>
                  <Input
                    id="startTime"
                    type="time"
                    value={formData.startTime}
                    onChange={(e) =>
                      handleInputChange("startTime", e.target.value)
                    }
                    className={`min-h-[2.5rem] h-auto text-sm ${
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
                  <Label htmlFor="selectedDate">Date *</Label>
                  <Input
                    id="selectedDate"
                    type="date"
                    value={formData.selectedDate}
                    onChange={(e) =>
                      handleInputChange("selectedDate", e.target.value)
                    }
                    className={`min-h-[2.5rem] h-auto text-sm ${
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
                  Additional Information
                </h3>
              </div>

              <div>
                <Label htmlFor="note">Notes</Label>
                <Input
                  id="note"
                  value={formData.note}
                  onChange={(e) => handleInputChange("note", e.target.value)}
                  placeholder="Additional notes (optional)"
                  className="min-h-[2.5rem] h-auto text-sm border-gray-300 focus:border-blue-500 focus:ring-blue-500/20 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                />
              </div>
            </div>

            {/* Helper text for required fields */}
            <div className="text-center pt-2">
              <p className="text-sm text-muted-foreground">
                Fields marked with * are required
              </p>
            </div>
          </div>

          <DialogFooter className="flex gap-2 pt-4">
            <Button
              variant="outline"
              onClick={handleCloseModal}
              className="px-6 hover:bg-gray-100 dark:hover:bg-gray-700"
            >
              Cancel
            </Button>
            <Button
              onClick={handleSaveAppointment}
              disabled={appointmentsLoading}
              className="px-6"
            >
              {appointmentsLoading
                ? "Saving..."
                : isEditMode
                ? "Update Appointment"
                : "Create Appointment"}
            </Button>
            {!isEditMode && (
              <Button
                variant="secondary"
                onClick={handleChainAppointment}
                disabled={appointmentsLoading}
                className="px-6"
                type="button"
              >
                + Add Another Right After
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
  );
};

export default Dashy;
