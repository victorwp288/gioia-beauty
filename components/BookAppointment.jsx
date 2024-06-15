'use client'
import React, { useEffect, useState, useCallback } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { CalendarDays, Clock } from 'lucide-react'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import {
  getFirestore,
  collection,
  addDoc,
  query,
  where,
  getDocs,
} from 'firebase/firestore'
import { ToastContainer, toast } from 'react-toastify'
import { db } from '@/utils/firebase'

const toasty = () => toast('Appointment Booked!')

const formSchema = z.object({
  date: z.date(),
  note: z.string(),
  name: z.string(),
  number: z.string(),
  email: z.string().email(),
  timeSlot: z.string(),
  selectedDate: z.date(),
  appointmentType: z.string(),
})

const appointmentTypes = [
  { type: 'Hair treatment', duration: 30 },
  { type: 'Nail treatment', duration: 60 },
  { type: 'Hair cut', duration: 90 },
  // Add more types as needed
]

const BookAppointment = () => {
  const [timeSlot, setTimeSlot] = useState([])
  const [selectedTimeSlot, setSelectedTimeSlot] = useState()
  const [selectedDate, setSelectedDate] = useState(new Date())
  const [appointmentType, setAppointmentType] = useState(appointmentTypes[0])

  const form = useForm({
    resolver: zodResolver(formSchema),
    defaultValues: {
      date: new Date(),
      note: '',
      name: '',
      number: '',
      email: '',
      timeSlot: '',
      selectedDate: new Date(),
      appointmentType: 'type1',
    },
  })

  const fetchTimeSlots = useCallback(
    async (date) => {
      if (!date) return

      const formattedDate = date.toISOString().split('T')[0]
      const q = query(
        collection(db, 'customers'),
        where('selectedDate', '==', formattedDate),
      )
      const querySnapshot = await getDocs(q)
      const data = querySnapshot.docs.map((doc) => doc.data())

      const allTimeSlots = Array.from(
        { length: Math.floor(((17 - 8) * 60) / appointmentType.duration) },
        (_, i) => {
          const time = 8 * 60 + i * appointmentType.duration
          const hours = Math.floor(time / 60)
          const minutes = time % 60
          return `${hours < 10 ? '0' : ''}${hours}:${
            minutes < 10 ? '0' : ''
          }${minutes}`
        },
      )
      const occupiedTimeSlots = data.map((item) => item.timeSlot)
      const availableTimeSlots = allTimeSlots.filter(
        (slot) => !occupiedTimeSlots.includes(slot),
      )

      setTimeSlot(availableTimeSlots)
      if (availableTimeSlots.length > 0) {
        const firstAvailableTimeSlot = availableTimeSlots[0]
        setSelectedTimeSlot(firstAvailableTimeSlot)
        form.setValue('timeSlot', firstAvailableTimeSlot)
      }
    },
    [appointmentType.duration, form],
  )

  useEffect(() => {
    fetchTimeSlots(selectedDate)
  }, [selectedDate, appointmentType, fetchTimeSlots])

  const handleSubmit = async (data) => {
    try {
      const docRef = await addDoc(collection(db, 'customers'), {
        ...data,
        selectedDate: data.selectedDate.toISOString().split('T')[0],
        appointmentType: data.appointmentType,
      })
      console.log('Appointment booked with ID:', docRef.id)
      toasty()
    } catch (error) {
      console.error('Error booking appointment:', error)
    }
  }

  const isPastDay = (day) =>
    day <= new Date() || day.getDay() === 0 || day.getDay() === 6

  return (
    <div className=" m-auto mt-12 w-[90vw] space-y-4  md:w-[70vw]">
      <div className="flex flex-col gap-2 py-1 md:gap-4 md:py-4">
        <h4 className="text-xs font-extrabold text-[#dec3c5] ">
          CONCEDITI UN MOMENTO DI RELAX
        </h4>
        <h2 className="font-serif text-2xl font-bold tracking-tight md:text-3xl">
          Prenota un appuntamento
        </h2>
      </div>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(handleSubmit)}>
          <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
            {/* Calendar */}
            <FormField
              control={form.control}
              name="date"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Select Date</FormLabel>
                  <FormControl>
                    <Calendar
                      mode="single"
                      selected={field.value}
                      onSelect={(date) => {
                        field.onChange(date)
                        setSelectedDate(date)
                        form.setValue('selectedDate', date)
                      }}
                      disabled={isPastDay}
                      className="w-full rounded-md border"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            {/* Time Slot */}
            <FormField
              control={form.control}
              name="timeSlot"
              render={({ field }) => (
                <FormItem className="mt-3 md:mt-0">
                  <FormLabel className="mb-3 flex items-center gap-2">
                    <Clock className="h-5 w-5 text-primary" />
                    Select Time Slot
                  </FormLabel>
                  <FormControl>
                    <div className="grid grid-cols-3 gap-2 rounded-lg border p-5">
                      {timeSlot.map((time, index) => (
                        <h2
                          key={index}
                          onClick={() => {
                            setSelectedTimeSlot(time)
                            field.onChange(time)
                          }}
                          className={`cursor-pointer rounded-full border p-2 text-center hover:bg-primary hover:text-white ${
                            time === selectedTimeSlot && 'bg-primary text-white'
                          }`}
                        >
                          {time}
                        </h2>
                      ))}
                    </div>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            {/* Appointment Type */}
            <FormField
              control={form.control}
              name="appointmentType"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Appointment Type</FormLabel>
                  <FormControl>
                    <select
                      className=" rounded-lg border border-[#e5e7eb] px-3 py-2 text-sm"
                      {...field}
                      onChange={(e) => {
                        const selectedType = appointmentTypes.find(
                          (type) => type.type === e.target.value,
                        )
                        setAppointmentType(selectedType)
                        field.onChange(e)
                      }}
                    >
                      {appointmentTypes.map((appointmentType) => (
                        <option
                          key={appointmentType.type}
                          value={appointmentType.type}
                        >
                          {appointmentType.type} - {appointmentType.duration}{' '}
                          minutes
                        </option>
                      ))}
                    </select>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            {/* Note */}
            <FormField
              control={form.control}
              name="note"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Note</FormLabel>
                  <FormControl>
                    <Input type="text" placeholder="Note" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            {/* Name */}
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Name</FormLabel>
                  <FormControl>
                    <Input type="text" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            {/* Phone Number */}
            <FormField
              control={form.control}
              name="number"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Phone Number</FormLabel>
                  <FormControl>
                    <Input type="text" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            {/* Email */}
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Email</FormLabel>
                  <FormControl>
                    <Input type="email" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Button className="mt-3" color="primary" type="submit">
              Book Appointment
            </Button>
          </div>
        </form>
        <ToastContainer />
      </Form>
    </div>
  )
}

export default BookAppointment
