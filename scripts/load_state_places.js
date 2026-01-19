const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

// Load environment variables from .env.local
// Try to load dotenv if available, otherwise read .env.local manually
try {
  // Try using dotenv package if installed
  require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });
} catch (e) {
  // If dotenv is not available, read .env.local manually
  try {
    const envPath = path.join(__dirname, '..', '.env.local');
    if (fs.existsSync(envPath)) {
      const envContent = fs.readFileSync(envPath, 'utf-8');
      envContent.split('\n').forEach(line => {
        const trimmedLine = line.trim();
        // Skip comments and empty lines
        if (trimmedLine && !trimmedLine.startsWith('#')) {
          const [key, ...valueParts] = trimmedLine.split('=');
          if (key && valueParts.length > 0) {
            const value = valueParts.join('=').trim().replace(/^["']|["']$/g, ''); // Remove quotes
            process.env[key.trim()] = value;
          }
        }
      });
    }
  } catch (err) {
    console.warn('Could not load .env.local file:', err.message);
  }
}

// Initialize Supabase client
// Use service role key if available (for bypassing RLS), otherwise use anon key
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Error: NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY (or SUPABASE_SERVICE_ROLE_KEY) must be set in .env.local');
  console.error('Note: For data loading, SUPABASE_SERVICE_ROLE_KEY is recommended to bypass RLS policies');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// State code normalization map (convert to uppercase standard format)
const stateCodeMap = {
  'ACT': 'ACT',
  'NSW': 'NSW',
  'Qld': 'QLD',
  'SA': 'SA',
  'Vic': 'VIC',
  'WA': 'WA',
  'TAS': 'TAS',
  'NT': 'NT',
};

async function loadStatePlaces() {
  try {
    // Read the CSV file
    const csvPath = path.join(__dirname, '..', 'state_places.csv');
    const csvContent = fs.readFileSync(csvPath, 'utf-8');
    const lines = csvContent.trim().split('\n');
    
    // Skip header row
    const dataLines = lines.slice(1);
    
    // Parse CSV data
    const statePlaces = [];
    for (const line of dataLines) {
      const [state, place] = line.split(',').map(s => s.trim());
      if (state && place) {
        // Normalize state code to uppercase
        const normalizedState = stateCodeMap[state] || state.toUpperCase();
        statePlaces.push({
          state: normalizedState,
          place: place,
        });
      }
    }
    
    console.log(`Found ${statePlaces.length} state-place combinations`);
    
    // Insert data into Supabase
    // Using upsert to handle duplicates gracefully
    const { data, error } = await supabase
      .from('state_places')
      .upsert(statePlaces, {
        onConflict: 'state,place',
        ignoreDuplicates: false,
      })
      .select();
    
    if (error) {
      console.error('Error loading data:', error);
      process.exit(1);
    }
    
    console.log(`Successfully loaded ${data.length} records into state_places table`);
    console.log('Sample records:');
    console.log(data.slice(0, 5));
    
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

// Run the script
loadStatePlaces();

