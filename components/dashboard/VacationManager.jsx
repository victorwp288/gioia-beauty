"use client";
import React, { useState, useEffect, useRef } from "react";
import { Calendar, Plus, Edit, Trash2, AlertTriangle } from "lucide-react";

// UI Components
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

// Context and Hooks
import { useAppointmentContext } from "@/context/AppointmentContext";
import { useNotification } from "@/context/NotificationContext";

// Utilities
import { formatDate, isValidDateRange, addDays } from "@/lib/utils/dateUtils";
import { validateVacationPeriod } from "@/lib/utils/validationSchemas";

const VacationManager = ({ isOpen, onClose }) => {
  const {
    vacationPeriods,
    vacationsLoading,
    createVacationPeriod,
    updateVacationPeriod,
    deleteVacationPeriod,
    fetchVacations,
  } = useAppointmentContext();

  const { showConfirmation, notifyAsync } = useNotification();

  // Modal states
  const [isAddEditModalOpen, setIsAddEditModalOpen] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [selectedVacation, setSelectedVacation] = useState(null);

  // Form state
  const [formData, setFormData] = useState({
    startDate: "",
    endDate: "",
    title: "",
    description: "",
  });

  // Form validation errors
  const [errors, setErrors] = useState({});

  // Track if we've fetched vacations to prevent infinite loops
  const hasFetchedRef = useRef(false);

  // Load vacation periods when modal opens (only if not already loaded)
  useEffect(() => {
    if (isOpen && !hasFetchedRef.current) {
      // Check if we already have vacation data from the context
      if (vacationPeriods && vacationPeriods.length > 0) {
        console.log(
          "🏖️ VacationManager: Using existing vacation data from context:",
          vacationPeriods.length
        );
        hasFetchedRef.current = true;
        return;
      }

      // Only fetch if we don't have data and haven't tried to fetch yet
      hasFetchedRef.current = true;
      console.log(
        "🏖️ VacationManager: Loading vacations (no existing data)..."
      );
      fetchVacations()
        .then((vacations) => {
          console.log(
            "🏖️ VacationManager: Loaded vacations:",
            vacations?.length || 0
          );
        })
        .catch((error) => {
          console.error("🏖️ VacationManager: Error loading vacations:", error);
          hasFetchedRef.current = false; // Reset on error so we can retry
        });
    }

    // Reset the flag when modal closes so we can check for updates next time
    if (!isOpen) {
      hasFetchedRef.current = false;
    }
  }, [isOpen, fetchVacations, vacationPeriods]); // Include vacationPeriods to react to context updates

  // Reset form when modal closes
  useEffect(() => {
    if (!isAddEditModalOpen) {
      resetForm();
    }
  }, [isAddEditModalOpen]);

  // ============================================================================
  // FORM HANDLERS
  // ============================================================================

  const resetForm = () => {
    setFormData({
      startDate: "",
      endDate: "",
      title: "",
      description: "",
    });
    setErrors({});
    setIsEditMode(false);
    setSelectedVacation(null);
  };

  const handleInputChange = (field, value) => {
    setFormData((prev) => ({
      ...prev,
      [field]: value,
    }));

    // Clear error for this field
    if (errors[field]) {
      setErrors((prev) => ({
        ...prev,
        [field]: null,
      }));
    }

    // Auto-set end date if only start date is provided
    if (field === "startDate" && value && !formData.endDate) {
      const nextDay = addDays(new Date(value), 1);
      setFormData((prev) => ({
        ...prev,
        endDate: nextDay.toISOString().split("T")[0],
      }));
    }
  };

  const validateForm = () => {
    const newErrors = {};

    if (!formData.startDate) {
      newErrors.startDate = "Start date is required";
    }

    if (!formData.endDate) {
      newErrors.endDate = "End date is required";
    }

    if (formData.startDate && formData.endDate) {
      const startDate = new Date(formData.startDate);
      const endDate = new Date(formData.endDate);

      if (endDate < startDate) {
        newErrors.endDate = "End date must be after start date";
      }

      // Check for overlaps with existing vacation periods
      const existingPeriods = vacationPeriods.filter(
        (vacation) => !isEditMode || vacation.id !== selectedVacation?.id
      );

      const hasOverlap = existingPeriods.some((vacation) => {
        const existingStart = new Date(vacation.startDate);
        const existingEnd = new Date(vacation.endDate);

        return (
          (startDate >= existingStart && startDate <= existingEnd) ||
          (endDate >= existingStart && endDate <= existingEnd) ||
          (startDate <= existingStart && endDate >= existingEnd)
        );
      });

      if (hasOverlap) {
        newErrors.general =
          "This vacation period overlaps with an existing one";
      }
    }

    if (!formData.title?.trim()) {
      newErrors.title = "Title is required";
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  // ============================================================================
  // VACATION OPERATIONS
  // ============================================================================

  const handleAddVacation = () => {
    const today = new Date();
    const tomorrow = addDays(today, 1);

    setFormData({
      startDate: today.toISOString().split("T")[0],
      endDate: tomorrow.toISOString().split("T")[0],
      title: "Vacation Period",
      description: "",
    });
    setIsEditMode(false);
    setSelectedVacation(null);
    setIsAddEditModalOpen(true);
  };

  const handleEditVacation = (vacation) => {
    // Parse the reason field to extract title and description
    let title = vacation.reason || "Vacation Period";
    let description = "";

    // If reason contains " - ", split it into title and description
    if (vacation.reason && vacation.reason.includes(" - ")) {
      const parts = vacation.reason.split(" - ");
      title = parts[0];
      description = parts.slice(1).join(" - ");
    }

    setFormData({
      startDate: new Date(vacation.startDate).toISOString().split("T")[0],
      endDate: new Date(vacation.endDate).toISOString().split("T")[0],
      title: title,
      description: description,
    });
    setSelectedVacation(vacation);
    setIsEditMode(true);
    setIsAddEditModalOpen(true);
  };

  const handleSaveVacation = async () => {
    if (!validateForm()) {
      return;
    }

    try {
      // Prepare the parameters in the format expected by the AppointmentContext
      const startDate = new Date(formData.startDate);
      const endDate = new Date(formData.endDate);
      const reason =
        formData.title.trim() +
        (formData.description?.trim()
          ? ` - ${formData.description.trim()}`
          : "");

      console.log("💾 VacationManager: Saving vacation with data:", {
        isEditMode,
        selectedVacation: selectedVacation?.id,
        startDate,
        endDate,
        reason,
        formData,
      });

      if (isEditMode && selectedVacation) {
        console.log(
          "✏️ VacationManager: Updating vacation:",
          selectedVacation.id
        );
        await notifyAsync(
          () =>
            updateVacationPeriod(
              selectedVacation.id,
              startDate,
              endDate,
              reason
            ),
          {
            loading: "Updating vacation period...",
            success: "Vacation period updated successfully!",
            error: "Failed to update vacation period",
          }
        );
      } else {
        console.log("➕ VacationManager: Creating new vacation");
        console.log(
          "📞 VacationManager: About to call createVacationPeriod with:",
          {
            startDate,
            endDate,
            reason,
          }
        );
        await notifyAsync(
          () => createVacationPeriod(startDate, endDate, reason),
          {
            loading: "Creating vacation period...",
            success: "Vacation period created successfully!",
            error: "Failed to create vacation period",
          }
        );
        console.log("✅ VacationManager: createVacationPeriod call completed");
      }

      setIsAddEditModalOpen(false);
      resetForm();

      // Force refresh the vacation list after successful save
      console.log("🔄 VacationManager: Refreshing vacation list after save");
      setTimeout(() => {
        hasFetchedRef.current = false;
        fetchVacations()
          .then((vacations) => {
            console.log(
              "🔄 VacationManager: Post-save refresh completed, vacations:",
              vacations
            );

            // If we just updated a vacation, verify it's still in the list
            if (isEditMode && selectedVacation) {
              const stillExists = vacations.find(
                (v) => v.id === selectedVacation.id
              );
              if (!stillExists) {
                console.warn(
                  "⚠️ VacationManager: Updated vacation missing from list, forcing another refresh"
                );
                setTimeout(() => {
                  fetchVacations().catch(console.error);
                }, 1000);
              } else {
                console.log(
                  "✅ VacationManager: Updated vacation confirmed in list:",
                  stillExists
                );
              }
            }
          })
          .catch(console.error);
      }, 500);
    } catch (error) {
      console.error("❌ VacationManager: Error saving vacation period:", error);
    }
  };

  const handleDeleteVacation = async (vacation) => {
    // Get the display title from the reason field
    const displayTitle =
      vacation.reason && vacation.reason.includes(" - ")
        ? vacation.reason.split(" - ")[0]
        : vacation.reason || "Vacation Period";

    const action = await showConfirmation({
      title: "Delete Vacation Period",
      message: `Are you sure you want to delete the vacation period "${displayTitle}"?\n\nThis action cannot be undone.`,
      confirmText: "Delete",
      // No cancelText - only X close button and Delete button
      type: "error",
      allowClose: true, // Ensure X close button is available
    });

    // Only proceed if user explicitly clicked "Delete" button
    if (action === "confirm") {
      try {
        console.log("🗑️ VacationManager: Deleting vacation:", vacation.id);
        await notifyAsync(() => deleteVacationPeriod(vacation.id), {
          loading: "Deleting vacation period...",
          success: "Vacation period deleted successfully!",
          error: "Failed to delete vacation period",
        });
        console.log("✅ VacationManager: Vacation deleted successfully");
      } catch (error) {
        console.error(
          "❌ VacationManager: Error deleting vacation period:",
          error
        );
      }
    } else {
      console.log(
        "❌ VacationManager: Delete cancelled by user, action:",
        action
      );
    }
  };

  // ============================================================================
  // RENDER HELPERS
  // ============================================================================

  const formatDateRange = (startDate, endDate) => {
    const start = formatDate(new Date(startDate));
    const end = formatDate(new Date(endDate));
    return `${start} - ${end}`;
  };

  const calculateDuration = (startDate, endDate) => {
    const start = new Date(startDate);
    const end = new Date(endDate);
    const diffTime = Math.abs(end - start);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
    return `${diffDays} day${diffDays !== 1 ? "s" : ""}`;
  };

  const getVacationStatus = (startDate, endDate) => {
    const now = new Date();
    const start = new Date(startDate);
    const end = new Date(endDate);

    if (now < start) {
      return { label: "Upcoming", color: "blue" };
    } else if (now >= start && now <= end) {
      return { label: "Active", color: "green" };
    } else {
      return { label: "Past", color: "gray" };
    }
  };

  return (
    <>
      {/* Main Vacation Manager Modal */}
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Calendar className="h-5 w-5" />
              Gestore ferie
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-6">
            {/* Add Button */}
            <div className="flex justify-between items-center">
              <p className="text-muted-foreground">
                Gestisci le ferie e i periodi di chiusura.
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    console.log("🔄 Manual refresh requested");
                    hasFetchedRef.current = false;
                    fetchVacations()
                      .then((vacations) => {
                        console.log("🔄 Manual refresh completed:", vacations);
                      })
                      .catch((error) => {
                        console.error("🔄 Manual refresh failed:", error);
                      });
                  }}
                  disabled={vacationsLoading}
                >
                  {vacationsLoading ? "Loading..." : "Refresh"}
                </Button>
                <Button
                  onClick={handleAddVacation}
                  className="flex items-center gap-2"
                >
                  <Plus className="h-4 w-4" />
                  Aggiungi periodo di Vacanza
                </Button>
              </div>
            </div>

            {/* Vacation Periods List */}
            <Card>
              <CardHeader>
                <CardTitle>Ferie impostate</CardTitle>
              </CardHeader>
              <CardContent>
                {vacationsLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <div className="text-muted-foreground">
                      Loading vacation periods...
                    </div>
                  </div>
                ) : vacationPeriods.length === 0 ? (
                  <div className="flex items-center justify-center py-8">
                    <div className="text-center">
                      <Calendar className="h-12 w-12 text-muted-foreground mx-auto mb-2" />
                      <p className="text-muted-foreground">
                        No vacation periods scheduled
                      </p>
                      <p className="text-sm text-muted-foreground">
                        Add a vacation period to block booking during that time
                      </p>
                    </div>
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Title</TableHead>
                        <TableHead>Date Range</TableHead>
                        <TableHead>Duration</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {vacationPeriods
                        .sort(
                          (a, b) =>
                            new Date(a.startDate) - new Date(b.startDate)
                        )
                        .map((vacation) => {
                          const status = getVacationStatus(
                            vacation.startDate,
                            vacation.endDate
                          );
                          return (
                            <TableRow key={vacation.id}>
                              <TableCell>
                                <div>
                                  <div className="font-medium">
                                    {(() => {
                                      // Display the reason as title, split if it contains description
                                      if (
                                        vacation.reason &&
                                        vacation.reason.includes(" - ")
                                      ) {
                                        return vacation.reason.split(" - ")[0];
                                      }
                                      return (
                                        vacation.reason || "Vacation Period"
                                      );
                                    })()}
                                  </div>
                                  {vacation.reason &&
                                    vacation.reason.includes(" - ") && (
                                      <div className="text-sm text-muted-foreground">
                                        {vacation.reason
                                          .split(" - ")
                                          .slice(1)
                                          .join(" - ")}
                                      </div>
                                    )}
                                </div>
                              </TableCell>
                              <TableCell>
                                {formatDateRange(
                                  vacation.startDate,
                                  vacation.endDate
                                )}
                              </TableCell>
                              <TableCell>
                                {calculateDuration(
                                  vacation.startDate,
                                  vacation.endDate
                                )}
                              </TableCell>
                              <TableCell>
                                <span
                                  className="inline-flex items-center px-2 py-1 text-xs font-medium rounded-full"
                                  style={{
                                    backgroundColor: `var(--${status.color}-100)`,
                                    color: `var(--${status.color}-700)`,
                                  }}
                                >
                                  {status.label}
                                </span>
                              </TableCell>
                              <TableCell>
                                <div className="flex items-center gap-2">
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => handleEditVacation(vacation)}
                                  >
                                    <Edit className="h-4 w-4" />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() =>
                                      handleDeleteVacation(vacation)
                                    }
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                </div>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={onClose}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add/Edit Vacation Modal */}
      <Dialog open={isAddEditModalOpen} onOpenChange={setIsAddEditModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {isEditMode ? "Edit Vacation Period" : "Add Vacation Period"}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            {errors.general && (
              <div className="flex items-center gap-2 p-3 text-sm text-red-700 bg-red-50 rounded-md">
                <AlertTriangle className="h-4 w-4" />
                {errors.general}
              </div>
            )}

            <div>
              <Label htmlFor="title">Title *</Label>
              <Input
                id="title"
                value={formData.title}
                onChange={(e) => handleInputChange("title", e.target.value)}
                placeholder="e.g., Summer Vacation, Holiday Break"
                className={errors.title ? "border-red-500" : ""}
              />
              {errors.title && (
                <p className="text-sm text-red-600 mt-1">{errors.title}</p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="startDate">Start Date *</Label>
                <Input
                  id="startDate"
                  type="date"
                  value={formData.startDate}
                  onChange={(e) =>
                    handleInputChange("startDate", e.target.value)
                  }
                  className={errors.startDate ? "border-red-500" : ""}
                />
                {errors.startDate && (
                  <p className="text-sm text-red-600 mt-1">
                    {errors.startDate}
                  </p>
                )}
              </div>
              <div>
                <Label htmlFor="endDate">End Date *</Label>
                <Input
                  id="endDate"
                  type="date"
                  value={formData.endDate}
                  onChange={(e) => handleInputChange("endDate", e.target.value)}
                  className={errors.endDate ? "border-red-500" : ""}
                />
                {errors.endDate && (
                  <p className="text-sm text-red-600 mt-1">{errors.endDate}</p>
                )}
              </div>
            </div>

            <div>
              <Label htmlFor="description">Description</Label>
              <Input
                id="description"
                value={formData.description}
                onChange={(e) =>
                  handleInputChange("description", e.target.value)
                }
                placeholder="Optional description or notes"
              />
            </div>

            {formData.startDate && formData.endDate && (
              <div className="p-3 bg-blue-50 rounded-md">
                <p className="text-sm text-blue-700">
                  Durata:{" "}
                  {calculateDuration(formData.startDate, formData.endDate)}
                </p>
                <p className="text-sm text-blue-600">
                  Attenzione: tutti gli appuntamenti in questo periodo saranno
                  bloccati e non potranno essere prenotati.
                </p>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsAddEditModalOpen(false)}
            >
              Cancel
            </Button>
            <Button onClick={handleSaveVacation}>
              {isEditMode ? "Update" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default VacationManager;
