"use client";
import * as React from "react";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
} from "lucide-react";
import { DayPicker } from "react-day-picker";

import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";

function Calendar({
  className,
  classNames,
  navLayout = "around",
  showOutsideDays = true,
  ...props
}) {
  return (
    <DayPicker
      navLayout={navLayout}
      showOutsideDays={showOutsideDays}
      className={cn("relative p-3", className)}
      classNames={{
        months:
          "flex flex-col sm:flex-row space-y-4 sm:space-x-4 sm:space-y-0 w-full",
        caption_label: "text-sm font-medium",
        nav: "space-x-1 flex items-center",
        month_grid: "w-full table-fixed",
        weekdays: "flex w-full",
        weekday:
          "text-muted-foreground rounded-md flex-1 font-normal text-[0.8rem] text-center",
        week: "flex w-full mt-2",
        day: "h-9 flex-1 text-center text-sm p-0 relative has-data-selected:bg-accent first:has-data-selected:rounded-l-md last:has-data-selected:rounded-r-md focus-within:relative focus-within:z-20",
        day_button: cn(
          buttonVariants({ variant: "ghost" }),
          "h-9 w-full p-0 font-normal aria-selected:opacity-100",
        ),
        range_end: "day-range-end",
        selected:
          "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground focus:bg-primary focus:text-primary-foreground",
        today: "bg-accent text-accent-foreground",
        outside:
          "day-outside text-muted-foreground opacity-50 aria-selected:bg-accent/50 aria-selected:text-muted-foreground aria-selected:opacity-30",
        disabled: "text-muted-foreground opacity-50",
        range_middle:
          "aria-selected:bg-accent aria-selected:text-accent-foreground",
        hidden: "invisible",
        ...classNames,
        month: cn("relative w-full space-y-4", classNames?.month),
        month_caption: cn(
          "flex h-7 items-center justify-center px-8",
          classNames?.month_caption,
        ),
        button_previous: cn(
          buttonVariants({ variant: "outline" }),
          "absolute left-3 top-3 z-10 h-7 w-7 bg-transparent p-0 opacity-60 hover:opacity-100",
          classNames?.button_previous,
        ),
        button_next: cn(
          buttonVariants({ variant: "outline" }),
          "absolute right-3 top-3 z-10 h-7 w-7 bg-transparent p-0 opacity-60 hover:opacity-100",
          classNames?.button_next,
        ),
      }}
      components={{
        Chevron: ({ orientation, ...iconProps }) => {
          const Icon =
            orientation === "left"
              ? ChevronLeft
              : orientation === "right"
                ? ChevronRight
                : orientation === "up"
                  ? ChevronUp
                  : ChevronDown;
          return <Icon {...iconProps} className="h-4 w-4" />;
        },
      }}
      {...props}
    />
  );
}
Calendar.displayName = "Calendar";

export { Calendar };
