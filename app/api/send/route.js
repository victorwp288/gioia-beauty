import { EmailTemplate } from "@/components/email/EmailTemplate";
import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

export async function POST(request) {
  try {
    // Estrarre anche appointmentType dal corpo della richiesta
    const { email, name, startTime, endTime, duration, date, appointmentType } =
      await request.json();

    console.log("Received data:", {
      email,
      name,
      startTime,
      endTime,
      duration,
      date,
      appointmentType,
    });

    // Invia l'email al cliente
    const { data: customerData, error: customerError } =
      await resend.emails.send({
        from: "Gioia Beauty <noreply@gioiabeauty.net>",
        to: [email],
        subject: "Ricevuta di prenotazione",
        react: EmailTemplate({
          name,
          startTime,
          endTime,
          duration,
          date,
          appointmentType,
        }),
      });

    if (customerError) {
      console.error("Error sending email to customer:", customerError);
      return new Response(JSON.stringify({ error: customerError }), {
        status: 500,
      });
    }

    // Invia l'email all'amministratore
    const { data: adminData, error: adminError } = await resend.emails.send({
      from: "Gioia Beauty <noreply@gioiabeauty.net>",
      to: ["gioiabeautyy@gmail.com"],
      subject: "Nuova prenotazione",
      react: EmailTemplate({
        name,
        startTime,
        endTime,
        duration,
        date,
        appointmentType,
        isAdmin: true,
      }),
    });

    if (adminError) {
      console.error("Error sending email to admin:", adminError);
      return new Response(JSON.stringify({ error: adminError }), {
        status: 500,
      });
    }

    return new Response(JSON.stringify({ customerData, adminData }), {
      status: 200,
    });
  } catch (error) {
    console.error("Catch error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
    });
  }
}
