import { handleCorrection } from '../_shared/handlers/withdraw-and-corrections.ts';
import { serve } from '../_shared/runtime.ts';

serve(handleCorrection);
