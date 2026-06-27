import mongoose from 'mongoose'

const MONGODB_URI = process.env.MONGODB_URI ?? 'mongodb://formgrid:formgrid@localhost:27017/formgrid'

export async function connectDatabase(): Promise<void> {
  mongoose.set('strictQuery', false)
  await mongoose.connect(MONGODB_URI, {
    maxPoolSize: 5,
    minPoolSize: 1,
    serverSelectionTimeoutMS: 5000,
    connectTimeoutMS: 5000,
  })
  console.log('[db] MongoDB connected')
}

export { mongoose }
