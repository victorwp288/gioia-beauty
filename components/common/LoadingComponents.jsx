"use client";
import React from "react";
import { Loader2, Calendar, Clock, User, MapPin } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

// Basic spinner component
export const LoadingSpinner = ({ size = "default", className = "" }) => {
  const sizeClasses = {
    sm: "h-4 w-4",
    default: "h-6 w-6",
    lg: "h-8 w-8",
    xl: "h-12 w-12",
  };

  return (
    <Loader2 className={`animate-spin ${sizeClasses[size]} ${className}`} />
  );
};

// Centered loading component
export const CenteredLoading = ({
  message = "Loading...",
  size = "default",
  className = "",
}) => {
  return (
    <div
      className={`flex flex-col items-center justify-center p-8 ${className}`}
    >
      <LoadingSpinner size={size} className="mb-2" />
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  );
};

// Full page loading component
export const FullPageLoading = ({ message = "Loading..." }) => {
  return (
    <div className="fixed inset-0 bg-white/80 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="text-center">
        <LoadingSpinner size="xl" className="mb-4 text-primary" />
        <p className="text-lg font-medium text-gray-900">{message}</p>
      </div>
    </div>
  );
};

// Button loading state
export const ButtonLoading = ({
  children,
  loading = false,
  loadingText = "Loading...",
  ...props
}) => {
  return (
    <button {...props} disabled={loading || props.disabled}>
      {loading ? (
        <>
          <LoadingSpinner size="sm" className="mr-2" />
          {loadingText}
        </>
      ) : (
        children
      )}
    </button>
  );
};

// Card skeleton for appointment loading
export const AppointmentCardSkeleton = () => {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <Skeleton className="h-4 w-[120px]" />
          <Skeleton className="h-4 w-[80px]" />
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center space-x-2">
          <Skeleton className="h-4 w-4" />
          <Skeleton className="h-4 w-[100px]" />
        </div>
        <div className="flex items-center space-x-2">
          <Skeleton className="h-4 w-4" />
          <Skeleton className="h-4 w-[150px]" />
        </div>
        <div className="flex items-center space-x-2">
          <Skeleton className="h-4 w-4" />
          <Skeleton className="h-4 w-[120px]" />
        </div>
      </CardContent>
    </Card>
  );
};

// Table row skeleton
export const TableRowSkeleton = ({ columns = 5 }) => {
  return (
    <tr className="border-b">
      {Array.from({ length: columns }).map((_, index) => (
        <td key={index} className="p-4">
          <Skeleton className="h-4 w-full" />
        </td>
      ))}
    </tr>
  );
};

// Appointment table loading
export const AppointmentTableLoading = ({ rows = 5 }) => {
  return (
    <div className="space-y-4">
      <Skeleton className="h-8 w-[200px]" /> {/* Table title */}
      <div className="border rounded-lg">
        <table className="w-full">
          <thead className="border-b bg-gray-50">
            <tr>
              <th className="p-4 text-left">
                <Skeleton className="h-4 w-[60px]" />
              </th>
              <th className="p-4 text-left">
                <Skeleton className="h-4 w-[80px]" />
              </th>
              <th className="p-4 text-left">
                <Skeleton className="h-4 w-[100px]" />
              </th>
              <th className="p-4 text-left">
                <Skeleton className="h-4 w-[70px]" />
              </th>
              <th className="p-4 text-left">
                <Skeleton className="h-4 w-[80px]" />
              </th>
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: rows }).map((_, index) => (
              <TableRowSkeleton key={index} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// Calendar loading skeleton
export const CalendarSkeleton = () => {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-6 w-[120px]" />
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {/* Calendar header */}
          <div className="flex justify-between items-center">
            <Skeleton className="h-5 w-[100px]" />
            <div className="flex space-x-2">
              <Skeleton className="h-8 w-8" />
              <Skeleton className="h-8 w-8" />
            </div>
          </div>

          {/* Calendar grid */}
          <div className="grid grid-cols-7 gap-1">
            {Array.from({ length: 42 }).map((_, index) => (
              <Skeleton key={index} className="h-8 w-8" />
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

// Dashboard stats skeleton
export const StatsCardSkeleton = () => {
  return (
    <Card>
      <CardContent className="p-6">
        <div className="flex items-center justify-between">
          <div className="space-y-2">
            <Skeleton className="h-4 w-[80px]" />
            <Skeleton className="h-8 w-[60px]" />
          </div>
          <Skeleton className="h-8 w-8 rounded-full" />
        </div>
      </CardContent>
    </Card>
  );
};

// Form loading overlay
export const FormLoadingOverlay = ({ message = "Saving..." }) => {
  return (
    <div className="absolute inset-0 bg-white/80 backdrop-blur-sm flex items-center justify-center rounded-lg z-10">
      <div className="text-center">
        <LoadingSpinner size="lg" className="mb-2 text-primary" />
        <p className="text-sm font-medium text-gray-900">{message}</p>
      </div>
    </div>
  );
};

// Appointment specific loading components
export const AppointmentListLoading = () => {
  return (
    <div className="space-y-4">
      {Array.from({ length: 5 }).map((_, index) => (
        <AppointmentCardSkeleton key={index} />
      ))}
    </div>
  );
};

// Dashboard loading layout
export const DashboardLoading = () => {
  return (
    <div className="space-y-6 p-4">
      {/* Stats cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <StatsCardSkeleton key={index} />
        ))}
      </div>

      {/* Action buttons */}
      <div className="flex space-x-4">
        <Skeleton className="h-10 w-[150px]" />
        <Skeleton className="h-10 w-[140px]" />
        <Skeleton className="h-10 w-[100px]" />
      </div>

      {/* Main content */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1">
          <CalendarSkeleton />
        </div>
        <div className="lg:col-span-2">
          <AppointmentTableLoading />
        </div>
      </div>
    </div>
  );
};

// Booking form loading
export const BookingFormLoading = () => {
  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <Skeleton className="h-6 w-[200px]" /> {/* Title */}
        {/* Form fields */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Skeleton className="h-4 w-[60px] mb-2" />
            <Skeleton className="h-10 w-full" />
          </div>
          <div>
            <Skeleton className="h-4 w-[80px] mb-2" />
            <Skeleton className="h-10 w-full" />
          </div>
        </div>
        <div>
          <Skeleton className="h-4 w-[100px] mb-2" />
          <Skeleton className="h-10 w-full" />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Skeleton className="h-4 w-[70px] mb-2" />
            <Skeleton className="h-10 w-full" />
          </div>
          <div>
            <Skeleton className="h-4 w-[90px] mb-2" />
            <Skeleton className="h-10 w-full" />
          </div>
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex justify-end space-x-2">
        <Skeleton className="h-10 w-[80px]" />
        <Skeleton className="h-10 w-[100px]" />
      </div>
    </div>
  );
};

// Progress indicator for multi-step processes
export const ProgressLoading = ({
  steps = [],
  currentStep = 0,
  message = "Processing...",
}) => {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-center">
        <LoadingSpinner size="lg" className="text-primary" />
      </div>

      <div className="text-center">
        <p className="font-medium">{message}</p>
        {steps.length > 0 && (
          <p className="text-sm text-muted-foreground mt-1">
            Step {currentStep + 1} of {steps.length}: {steps[currentStep]}
          </p>
        )}
      </div>

      {steps.length > 0 && (
        <div className="flex justify-center">
          <div className="flex space-x-2">
            {steps.map((_, index) => (
              <div
                key={index}
                className={`h-2 w-8 rounded-full ${
                  index <= currentStep ? "bg-primary" : "bg-gray-200"
                }`}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

// Export all components
export default {
  LoadingSpinner,
  CenteredLoading,
  FullPageLoading,
  ButtonLoading,
  AppointmentCardSkeleton,
  TableRowSkeleton,
  AppointmentTableLoading,
  CalendarSkeleton,
  StatsCardSkeleton,
  FormLoadingOverlay,
  AppointmentListLoading,
  DashboardLoading,
  BookingFormLoading,
  ProgressLoading,
};
