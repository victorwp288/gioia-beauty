import clsx from "clsx";
import { useId } from "react";

const formClasses =
  "block w-full appearance-none rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-blue-500 sm:text-sm";

function Label({ id, children }) {
  return (
    <label
      htmlFor={id}
      className="mb-3 block text-sm font-medium text-gray-700"
    >
      {children}
    </label>
  );
}

export function TextField({ label, type = "text", className, name, ...props }) {
  // Use name prop for ID if available, fallback to useId for hydration safety
  const generatedId = useId();
  const id = name || generatedId;

  return (
    <div className={className}>
      {label && <Label id={id}>{label}</Label>}
      <input
        id={id}
        name={name}
        type={type}
        {...props}
        className={formClasses}
      />
    </div>
  );
}

export function SelectField({ label, className, name, ...props }) {
  // Use name prop for ID if available, fallback to useId for hydration safety
  const generatedId = useId();
  const id = name || generatedId;

  return (
    <div className={className}>
      {label && <Label id={id}>{label}</Label>}
      <select
        id={id}
        name={name}
        {...props}
        className={clsx(formClasses, "pr-8")}
      />
    </div>
  );
}
