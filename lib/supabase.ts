import { createClient } from "@supabase/supabase-js";

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL ??
  "https://dnnqqdszukuwdzuqyuki.supabase.co";

const supabasePublishableKey =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  "sb_publishable_SZTC5s7DzR-25peRXYYM7w_Ao4B_xb_";

export const supabase = createClient(supabaseUrl, supabasePublishableKey);
