"use client";
import React, {
  createContext,
  useContext,
  useReducer,
  useCallback,
  useEffect,
} from "react";
import { toast } from "react-toastify";
import { UI_CONFIG } from "../lib/utils/constants";

// Import alert dialog components
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

// Notification types
export const NotificationTypes = {
  SUCCESS: "success",
  ERROR: "error",
  WARNING: "warning",
  INFO: "info",
  LOADING: "loading",
};

// Initial state
const initialState = {
  // Toast notifications
  toasts: [],

  // Global loading states
  globalLoading: false,
  loadingMessage: "",

  // Alert/banner notifications
  alerts: [],

  // Progress notifications
  progress: {},

  // Confirmation dialogs
  confirmations: [],

  // Settings
  settings: {
    enableToasts: true,
    enableSounds: false,
    toastDuration: UI_CONFIG.TOAST_DURATION,
    position: "top-right",
    maxToasts: 5,
    enableProgress: true,
  },

  // Statistics
  stats: {
    totalNotifications: 0,
    successCount: 0,
    errorCount: 0,
    warningCount: 0,
    infoCount: 0,
  },
};

// Action types
const ActionTypes = {
  // Toast actions
  ADD_TOAST: "ADD_TOAST",
  REMOVE_TOAST: "REMOVE_TOAST",
  CLEAR_TOASTS: "CLEAR_TOASTS",
  UPDATE_TOAST: "UPDATE_TOAST",

  // Global loading
  SET_GLOBAL_LOADING: "SET_GLOBAL_LOADING",

  // Alert actions
  ADD_ALERT: "ADD_ALERT",
  REMOVE_ALERT: "REMOVE_ALERT",
  CLEAR_ALERTS: "CLEAR_ALERTS",

  // Progress actions
  SET_PROGRESS: "SET_PROGRESS",
  UPDATE_PROGRESS: "UPDATE_PROGRESS",
  REMOVE_PROGRESS: "REMOVE_PROGRESS",

  // Confirmation actions
  ADD_CONFIRMATION: "ADD_CONFIRMATION",
  REMOVE_CONFIRMATION: "REMOVE_CONFIRMATION",

  // Settings
  UPDATE_SETTINGS: "UPDATE_SETTINGS",

  // Statistics
  UPDATE_STATS: "UPDATE_STATS",
};

// Reducer
const notificationReducer = (state, action) => {
  switch (action.type) {
    case ActionTypes.ADD_TOAST:
      return {
        ...state,
        toasts: [
          ...state.toasts.slice(-(state.settings.maxToasts - 1)),
          {
            id: action.payload.id,
            type: action.payload.type,
            message: action.payload.message,
            title: action.payload.title,
            duration: action.payload.duration,
            persistent: action.payload.persistent,
            actions: action.payload.actions,
            metadata: action.payload.metadata,
            createdAt: Date.now(),
          },
        ],
        stats: {
          ...state.stats,
          totalNotifications: state.stats.totalNotifications + 1,
          [`${action.payload.type}Count`]:
            state.stats[`${action.payload.type}Count`] + 1,
        },
      };

    case ActionTypes.REMOVE_TOAST:
      return {
        ...state,
        toasts: state.toasts.filter((toast) => toast.id !== action.payload),
      };

    case ActionTypes.CLEAR_TOASTS:
      return {
        ...state,
        toasts: [],
      };

    case ActionTypes.UPDATE_TOAST:
      return {
        ...state,
        toasts: state.toasts.map((toast) =>
          toast.id === action.payload.id
            ? { ...toast, ...action.payload.updates }
            : toast
        ),
      };

    case ActionTypes.SET_GLOBAL_LOADING:
      return {
        ...state,
        globalLoading: action.payload.loading,
        loadingMessage: action.payload.message || "",
      };

    case ActionTypes.ADD_ALERT:
      return {
        ...state,
        alerts: [
          ...state.alerts,
          {
            id: action.payload.id,
            type: action.payload.type,
            message: action.payload.message,
            title: action.payload.title,
            persistent: action.payload.persistent,
            dismissible: action.payload.dismissible,
            actions: action.payload.actions,
            createdAt: Date.now(),
          },
        ],
      };

    case ActionTypes.REMOVE_ALERT:
      return {
        ...state,
        alerts: state.alerts.filter((alert) => alert.id !== action.payload),
      };

    case ActionTypes.CLEAR_ALERTS:
      return {
        ...state,
        alerts: [],
      };

    case ActionTypes.SET_PROGRESS:
      return {
        ...state,
        progress: {
          ...state.progress,
          [action.payload.id]: {
            value: action.payload.value,
            message: action.payload.message,
            indeterminate: action.payload.indeterminate,
            createdAt: Date.now(),
          },
        },
      };

    case ActionTypes.UPDATE_PROGRESS:
      return {
        ...state,
        progress: {
          ...state.progress,
          [action.payload.id]: {
            ...state.progress[action.payload.id],
            ...action.payload.updates,
          },
        },
      };

    case ActionTypes.REMOVE_PROGRESS:
      const newProgress = { ...state.progress };
      delete newProgress[action.payload];
      return {
        ...state,
        progress: newProgress,
      };

    case ActionTypes.ADD_CONFIRMATION:
      return {
        ...state,
        confirmations: [
          ...state.confirmations,
          {
            id: action.payload.id,
            title: action.payload.title,
            message: action.payload.message,
            confirmText: action.payload.confirmText || "Confirm",
            cancelText: action.payload.cancelText,
            type: action.payload.type || "warning",
            allowClose: action.payload.allowClose !== false,
            onConfirm: action.payload.onConfirm,
            onCancel: action.payload.onCancel,
            onClose: action.payload.onClose,
            createdAt: Date.now(),
          },
        ],
      };

    case ActionTypes.REMOVE_CONFIRMATION:
      return {
        ...state,
        confirmations: state.confirmations.filter(
          (confirmation) => confirmation.id !== action.payload
        ),
      };

    case ActionTypes.UPDATE_SETTINGS:
      return {
        ...state,
        settings: { ...state.settings, ...action.payload },
      };

    case ActionTypes.UPDATE_STATS:
      return {
        ...state,
        stats: { ...state.stats, ...action.payload },
      };

    default:
      return state;
  }
};

// Create context
const NotificationContext = createContext();

// Custom hook to use notification context
export const useNotification = () => {
  const context = useContext(NotificationContext);
  if (!context) {
    throw new Error(
      "useNotification must be used within a NotificationProvider"
    );
  }
  return context;
};

// Notification provider component
export const NotificationProvider = ({ children }) => {
  const [state, dispatch] = useReducer(notificationReducer, initialState);

  // Generate unique ID for notifications
  const generateId = useCallback(() => {
    return `notification_${Date.now()}_${Math.random()
      .toString(36)
      .substr(2, 9)}`;
  }, []);

  // ============================================================================
  // TOAST NOTIFICATIONS
  // ============================================================================

  const showToast = useCallback(
    (type, message, options = {}) => {
      if (!state.settings.enableToasts) return null;

      const id = generateId();
      const toastConfig = {
        id,
        type,
        message,
        title: options.title,
        duration: options.duration || state.settings.toastDuration,
        persistent: options.persistent || false,
        actions: options.actions || [],
        metadata: options.metadata || {},
      };

      dispatch({
        type: ActionTypes.ADD_TOAST,
        payload: toastConfig,
      });

      // Use react-toastify for actual toast display
      const toastMethod = toast[type] || toast;
      const toastId = toastMethod(message, {
        toastId: id,
        autoClose: toastConfig.persistent ? false : toastConfig.duration,
        position: state.settings.position,
        onClose: () => removeToast(id),
      });

      // Auto-remove non-persistent toasts
      if (!toastConfig.persistent) {
        setTimeout(() => {
          removeToast(id);
        }, toastConfig.duration);
      }

      return id;
    },
    [state.settings, generateId]
  );

  const showSuccess = useCallback(
    (message, options = {}) => {
      return showToast(NotificationTypes.SUCCESS, message, options);
    },
    [showToast]
  );

  const showError = useCallback(
    (message, options = {}) => {
      return showToast(NotificationTypes.ERROR, message, options);
    },
    [showToast]
  );

  const showWarning = useCallback(
    (message, options = {}) => {
      return showToast(NotificationTypes.WARNING, message, options);
    },
    [showToast]
  );

  const showInfo = useCallback(
    (message, options = {}) => {
      return showToast(NotificationTypes.INFO, message, options);
    },
    [showToast]
  );

  const showLoading = useCallback(
    (message, options = {}) => {
      return showToast(NotificationTypes.LOADING, message, {
        ...options,
        persistent: true,
      });
    },
    [showToast]
  );

  const updateToast = useCallback((id, updates) => {
    dispatch({
      type: ActionTypes.UPDATE_TOAST,
      payload: { id, updates },
    });

    // Update react-toastify toast if needed
    if (updates.message) {
      toast.update(id, {
        render: updates.message,
        type: updates.type,
      });
    }
  }, []);

  const removeToast = useCallback((id) => {
    dispatch({
      type: ActionTypes.REMOVE_TOAST,
      payload: id,
    });

    // Dismiss react-toastify toast
    toast.dismiss(id);
  }, []);

  const clearToasts = useCallback(() => {
    dispatch({ type: ActionTypes.CLEAR_TOASTS });
    toast.dismiss();
  }, []);

  // ============================================================================
  // GLOBAL LOADING
  // ============================================================================

  const setGlobalLoading = useCallback((loading, message = "") => {
    dispatch({
      type: ActionTypes.SET_GLOBAL_LOADING,
      payload: { loading, message },
    });
  }, []);

  // ============================================================================
  // ALERT NOTIFICATIONS
  // ============================================================================

  const showAlert = useCallback(
    (type, message, options = {}) => {
      const id = generateId();

      dispatch({
        type: ActionTypes.ADD_ALERT,
        payload: {
          id,
          type,
          message,
          title: options.title,
          persistent: options.persistent || false,
          dismissible: options.dismissible !== false,
          actions: options.actions || [],
        },
      });

      // Auto-remove non-persistent alerts
      if (!options.persistent) {
        setTimeout(() => {
          removeAlert(id);
        }, options.duration || 10000);
      }

      return id;
    },
    [generateId]
  );

  const removeAlert = useCallback((id) => {
    dispatch({
      type: ActionTypes.REMOVE_ALERT,
      payload: id,
    });
  }, []);

  const clearAlerts = useCallback(() => {
    dispatch({ type: ActionTypes.CLEAR_ALERTS });
  }, []);

  // ============================================================================
  // PROGRESS NOTIFICATIONS
  // ============================================================================

  const setProgress = useCallback(
    (id, value, message = "", indeterminate = false) => {
      dispatch({
        type: ActionTypes.SET_PROGRESS,
        payload: { id, value, message, indeterminate },
      });
    },
    []
  );

  const updateProgress = useCallback((id, updates) => {
    dispatch({
      type: ActionTypes.UPDATE_PROGRESS,
      payload: { id, updates },
    });
  }, []);

  const removeProgress = useCallback((id) => {
    dispatch({
      type: ActionTypes.REMOVE_PROGRESS,
      payload: id,
    });
  }, []);

  // ============================================================================
  // CONFIRMATION DIALOGS
  // ============================================================================

  const showConfirmation = useCallback(
    (config) => {
      return new Promise((resolve) => {
        const id = generateId();

        const onConfirm = () => {
          if (config.onConfirm) {
            config.onConfirm();
          }
          removeConfirmation(id);
          resolve("confirm");
        };

        const onCancel = () => {
          if (config.onCancel) {
            config.onCancel();
          }
          removeConfirmation(id);
          resolve("cancel");
        };

        const onClose = () => {
          if (config.onClose) {
            config.onClose();
          }
          removeConfirmation(id);
          resolve("close");
        };

        dispatch({
          type: ActionTypes.ADD_CONFIRMATION,
          payload: {
            id,
            title: config.title || "Confirm Action",
            message: config.message,
            confirmText: config.confirmText || "Confirm",
            cancelText: config.cancelText,
            type: config.type || "warning",
            allowClose: config.allowClose !== false,
            onConfirm,
            onCancel,
            onClose,
          },
        });
      });
    },
    [generateId]
  );

  const removeConfirmation = useCallback((id) => {
    dispatch({
      type: ActionTypes.REMOVE_CONFIRMATION,
      payload: id,
    });
  }, []);

  // ============================================================================
  // SETTINGS
  // ============================================================================

  const updateSettings = useCallback((settings) => {
    dispatch({
      type: ActionTypes.UPDATE_SETTINGS,
      payload: settings,
    });
  }, []);

  // ============================================================================
  // UTILITY FUNCTIONS
  // ============================================================================

  const clearAll = useCallback(() => {
    clearToasts();
    clearAlerts();
  }, [clearToasts, clearAlerts]);

  const getNotificationStats = useCallback(() => {
    return state.stats;
  }, [state.stats]);

  // Convenience methods for common operations
  const notifyOperation = useCallback(
    async (operation, loadingMessage, successMessage, errorMessage) => {
      const loadingId = showLoading(loadingMessage);

      try {
        const result = await operation();
        removeToast(loadingId);
        showSuccess(successMessage || "Operation completed successfully");
        return result;
      } catch (error) {
        removeToast(loadingId);
        showError(errorMessage || `Operation failed: ${error.message}`);
        throw error;
      }
    },
    [showLoading, removeToast, showSuccess, showError]
  );

  const notifyAsync = useCallback(
    async (asyncFn, messages = {}) => {
      const {
        loading = "Processing...",
        success = "Operation completed successfully",
        error = "Operation failed",
      } = messages;

      return notifyOperation(asyncFn, loading, success, error);
    },
    [notifyOperation]
  );

  // ============================================================================
  // EFFECTS
  // ============================================================================

  // Clean up expired notifications periodically
  useEffect(() => {
    const cleanup = setInterval(() => {
      const now = Date.now();
      const cutoff = now - 24 * 60 * 60 * 1000; // 24 hours

      // Remove old toasts that somehow didn't get cleaned up
      state.toasts.forEach((toast) => {
        if (toast.createdAt < cutoff && !toast.persistent) {
          removeToast(toast.id);
        }
      });

      // Remove old alerts
      state.alerts.forEach((alert) => {
        if (alert.createdAt < cutoff && !alert.persistent) {
          removeAlert(alert.id);
        }
      });
    }, 5 * 60 * 1000); // Every 5 minutes

    return () => clearInterval(cleanup);
  }, [state.toasts, state.alerts, removeToast, removeAlert]);

  // ============================================================================
  // CONFIRMATION DIALOGS COMPONENT
  // ============================================================================

  const ConfirmationDialogs = () => {
    return (
      <>
        {state.confirmations.map((confirmation) => (
          <AlertDialog
            key={confirmation.id}
            open={true}
            onOpenChange={(open) => {
              if (!open && confirmation.allowClose) {
                confirmation.onClose();
              }
            }}
          >
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{confirmation.title}</AlertDialogTitle>
                <AlertDialogDescription>
                  {confirmation.message}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter className="flex gap-2">
                {confirmation.allowClose && (
                  <AlertDialogCancel
                    onClick={confirmation.onClose}
                    className="mr-auto bg-gray-100 hover:bg-gray-200 text-gray-700 dark:bg-gray-700 dark:hover:bg-gray-600 dark:text-gray-200"
                  >
                    ✕ Close
                  </AlertDialogCancel>
                )}
                <div className="flex gap-2 ml-auto">
                  {confirmation.cancelText && (
                    <AlertDialogCancel onClick={confirmation.onCancel}>
                      {confirmation.cancelText}
                    </AlertDialogCancel>
                  )}
                  <AlertDialogAction
                    onClick={confirmation.onConfirm}
                    className={
                      confirmation.type === "error"
                        ? "bg-red-600 hover:bg-red-700 focus:bg-red-700 active:bg-red-800 text-white border-red-600 dark:bg-red-600 dark:hover:bg-red-700 dark:text-white !important"
                        : ""
                    }
                    style={
                      confirmation.type === "error"
                        ? {
                            backgroundColor: "#dc2626",
                            borderColor: "#dc2626",
                            color: "white",
                          }
                        : {}
                    }
                  >
                    {confirmation.confirmText}
                  </AlertDialogAction>
                </div>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        ))}
      </>
    );
  };

  // Context value
  const contextValue = {
    // State
    ...state,

    // Toast methods
    showToast,
    showSuccess,
    showError,
    showWarning,
    showInfo,
    showLoading,
    updateToast,
    removeToast,
    clearToasts,

    // Global loading
    setGlobalLoading,

    // Alert methods
    showAlert,
    removeAlert,
    clearAlerts,

    // Progress methods
    setProgress,
    updateProgress,
    removeProgress,

    // Confirmation methods
    showConfirmation,
    removeConfirmation,

    // Settings
    updateSettings,

    // Utilities
    clearAll,
    getNotificationStats,
    notifyOperation,
    notifyAsync,
  };

  return (
    <NotificationContext.Provider value={contextValue}>
      {children}
      <ConfirmationDialogs />
    </NotificationContext.Provider>
  );
};

export default NotificationProvider;
