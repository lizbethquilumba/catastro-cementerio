import { createClient } from '@supabase/supabase-js';
// Variables de entorno o constantes centralizadas
const supabaseUrl = 'https://vktroniubxzxxxukirzn.supabase.co';
const supabaseAnonKey = 'sb_publishable_muDq3JHY2_MhdNyhFXlEow_Cm4iPmjj';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);