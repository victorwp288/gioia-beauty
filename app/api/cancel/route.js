import { CancelEmailTemplate } from "@/components/email/CancelEmailTemplate";
import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

export async function POST(request) {
  try {
    const { email, name, startTime, endTime, duration, date } =
      await request.json();

    console.log("Received data:", {
      email,
      name,
      startTime,
      endTime,
      duration,
      date,
    });

    const { data, error } = await resend.emails.send({
      from: "Gioia Beauty <noreply@gioiabeauty.net>",
      to: [email],
      subject: "Cancellazione appuntamento",
      react: CancelEmailTemplate({ name, startTime, endTime, duration, date }),
    });

    if (error) {
      console.error("Error sending email:", error);
      return new Response(JSON.stringify({ error }), { status: 500 });
    }

    return new Response(JSON.stringify(data), { status: 200 });
  } catch (error) {
    console.error("Catch error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
    });
  }
}
